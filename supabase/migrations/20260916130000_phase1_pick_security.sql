-- Phase 1 corrective migration: pick identity immutability, DB-controlled
-- insert timestamps, concurrency-safe team reuse, membership-checked player
-- updates, and read-only teams for app users.
-- Do not apply to remote Supabase until explicitly approved.

-- ---------------------------------------------------------------------------
-- Lock helpers: locks_at <= now() is locked (exact timestamp included).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.week_is_unlocked(p_week_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.weeks w
    WHERE w.id = p_week_id
      AND w.locks_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.week_is_locked(p_week_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.weeks w
    WHERE w.id = p_week_id
      AND w.locks_at <= now()
  );
$$;

CREATE OR REPLACE FUNCTION public.playoff_round_is_unlocked(p_playoff_round_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.playoff_rounds pr
    WHERE pr.id = p_playoff_round_id
      AND pr.locks_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.playoff_round_is_locked(p_playoff_round_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.playoff_rounds pr
    WHERE pr.id = p_playoff_round_id
      AND pr.locks_at <= now()
  );
$$;

-- ---------------------------------------------------------------------------
-- Concurrency-safe team reuse via transaction-scoped advisory locks.
--
-- Lock key construction:
--   hashtextextended('<namespace>/' || season_id || '/' || user_id || '/' || team_id, 0)
-- where namespace is literally 'regular' or 'playoff'.
--
-- Why regular and playoff cannot collide in a behavior-changing way:
-- The namespace prefix is part of the hashed string, so an identical
-- (season_id, user_id, team_id) pair in regular season vs playoffs produces
-- distinct lock keys. Contests therefore serialize independently and cannot
-- block or unlock each other through shared lock identity. Accidental
-- bigint hash collisions remain theoretically possible (as with any advisory
-- lock) but are not systematic across contest types.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_unique_team_per_season()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id UUID;
  v_lock_key BIGINT;
BEGIN
  SELECT w.season_id INTO v_season_id
  FROM public.weeks w
  WHERE w.id = NEW.week_id;

  v_lock_key := hashtextextended(
    'regular/' || v_season_id::text || '/' || NEW.user_id::text || '/' || NEW.team_id::text,
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF EXISTS (
    SELECT 1
    FROM public.picks p
    INNER JOIN public.weeks w ON w.id = p.week_id
    WHERE p.user_id = NEW.user_id
      AND p.team_id = NEW.team_id
      AND w.season_id = v_season_id
      AND p.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Team already used by this player in the same season'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_unique_team_per_playoff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id UUID;
  v_lock_key BIGINT;
BEGIN
  SELECT pr.season_id INTO v_season_id
  FROM public.playoff_rounds pr
  WHERE pr.id = NEW.playoff_round_id;

  v_lock_key := hashtextextended(
    'playoff/' || v_season_id::text || '/' || NEW.user_id::text || '/' || NEW.team_id::text,
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  IF EXISTS (
    SELECT 1
    FROM public.playoff_picks pp
    INNER JOIN public.playoff_rounds pr ON pr.id = pp.playoff_round_id
    WHERE pp.user_id = NEW.user_id
      AND pp.team_id = NEW.team_id
      AND pr.season_id = v_season_id
      AND pp.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Team already used by this player in the same playoffs'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS playoff_picks_enforce_unique_team_per_playoff
  ON public.playoff_picks;

CREATE TRIGGER playoff_picks_enforce_unique_team_per_playoff
BEFORE INSERT OR UPDATE OF team_id, playoff_round_id, user_id
ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_unique_team_per_playoff();

-- Ensure regular-season trigger still points at the replaced function.
DROP TRIGGER IF EXISTS picks_enforce_unique_team_per_season ON public.picks;
CREATE TRIGGER picks_enforce_unique_team_per_season
BEFORE INSERT OR UPDATE OF team_id, week_id, user_id
ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_unique_team_per_season();

-- ---------------------------------------------------------------------------
-- Authenticated inserts: submitted_at and updated_at are database-controlled.
-- Client-supplied timestamp values are ignored (overwritten).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_regular_pick_insert_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.submitted_at := now();
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_playoff_pick_insert_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.submitted_at := now();
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS picks_enforce_insert_audit ON public.picks;
CREATE TRIGGER picks_enforce_insert_audit
BEFORE INSERT ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_regular_pick_insert_audit();

DROP TRIGGER IF EXISTS playoff_picks_enforce_insert_audit ON public.playoff_picks;
CREATE TRIGGER playoff_picks_enforce_insert_audit
BEFORE INSERT ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_playoff_pick_insert_audit();

-- ---------------------------------------------------------------------------
-- Update guards
-- 1) Identity fields immutable for ALL authenticated users (before any
--    commissioner exception): id, user_id, week_id/playoff_round_id, submitted_at
-- 2) Commissioner authority uses OLD.week_id / OLD.playoff_round_id
-- 3) Commissioners may update results/points/team_id but not reassign picks
-- 4) Players may change only team_id (before lock, enforced by RLS)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_regular_pick_update_guards()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Immutable for every authenticated caller, including commissioners.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.week_id IS DISTINCT FROM OLD.week_id
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Pick identity fields are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Commissioner of the pick's existing league may edit result/team.
  IF public.is_league_commissioner(public.league_id_for_week(OLD.week_id)) THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.result IS DISTINCT FROM OLD.result THEN
    RAISE EXCEPTION 'Players may only change team_id on picks'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_playoff_pick_update_guards()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.playoff_round_id IS DISTINCT FROM OLD.playoff_round_id
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Pick identity fields are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.is_league_commissioner(
    public.league_id_for_playoff_round(OLD.playoff_round_id)
  ) THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.result IS DISTINCT FROM OLD.result
     OR NEW.points_awarded IS DISTINCT FROM OLD.points_awarded THEN
    RAISE EXCEPTION 'Players may only change team_id on playoff picks'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS picks_enforce_player_columns ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_update_guards ON public.picks;
CREATE TRIGGER picks_enforce_update_guards
BEFORE UPDATE ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_regular_pick_update_guards();

DROP TRIGGER IF EXISTS playoff_picks_enforce_player_columns ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_update_guards ON public.playoff_picks;
CREATE TRIGGER playoff_picks_enforce_update_guards
BEFORE UPDATE ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_playoff_pick_update_guards();

-- Result permission triggers reinforce commissioner-only scoring using OLD ids.
CREATE OR REPLACE FUNCTION public.enforce_regular_pick_result_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.result IS DISTINCT FROM OLD.result
     AND NOT public.is_league_commissioner(public.league_id_for_week(OLD.week_id)) THEN
    RAISE EXCEPTION 'Only commissioners can set pick results'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_playoff_pick_result_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (
       NEW.result IS DISTINCT FROM OLD.result
       OR NEW.points_awarded IS DISTINCT FROM OLD.points_awarded
     )
     AND NOT public.is_league_commissioner(
       public.league_id_for_playoff_round(OLD.playoff_round_id)
     ) THEN
    RAISE EXCEPTION 'Only commissioners can set pick results'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Player pick UPDATE policies: active membership in USING and WITH CHECK.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS picks_update_own_before_lock ON public.picks;
CREATE POLICY picks_update_own_before_lock
ON public.picks
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.week_is_unlocked(week_id)
)
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.week_is_unlocked(week_id)
);

DROP POLICY IF EXISTS playoff_picks_update_own_before_lock ON public.playoff_picks;
CREATE POLICY playoff_picks_update_own_before_lock
ON public.playoff_picks
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND public.is_active_league_member(
    public.league_id_for_playoff_round(playoff_round_id)
  )
  AND public.playoff_round_is_unlocked(playoff_round_id)
)
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND points_awarded = 0
  AND public.is_active_league_member(
    public.league_id_for_playoff_round(playoff_round_id)
  )
  AND public.playoff_round_is_unlocked(playoff_round_id)
);

-- ---------------------------------------------------------------------------
-- Teams: read-only for authenticated app users. Changes via migrations only.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS teams_manage_commissioner_any ON public.teams;

REVOKE INSERT, UPDATE, DELETE ON public.teams FROM authenticated;
GRANT SELECT ON public.teams TO authenticated;

-- ---------------------------------------------------------------------------
-- Reaffirm helper grants (no PUBLIC execute)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.is_active_league_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_league_commissioner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_league_with(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_member_of_any_league() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_any_league_commissioner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.league_id_for_season(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.league_id_for_week(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.league_id_for_playoff_round(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.week_is_unlocked(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.week_is_locked(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.playoff_round_is_unlocked(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.playoff_round_is_locked(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_active_league_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_league_commissioner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_league_with(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_member_of_any_league() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_any_league_commissioner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_id_for_season(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_id_for_week(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_id_for_playoff_round(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.week_is_unlocked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.week_is_locked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.playoff_round_is_unlocked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.playoff_round_is_locked(UUID) TO authenticated;
