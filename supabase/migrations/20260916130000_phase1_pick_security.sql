-- Phase 1 corrective migration: pick column guards, playoff reuse,
-- membership-checked player updates, and read-only teams for app users.
-- Do not apply to remote Supabase until explicitly approved.

-- ---------------------------------------------------------------------------
-- Harden lock helpers: locks_at == now() is locked (already <= / >).
-- Reaffirm search_path on all SECURITY DEFINER helpers.
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
-- Regular-season team reuse (unchanged rule, reaffirm SECURITY DEFINER)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_unique_team_per_season()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id UUID;
BEGIN
  SELECT w.season_id INTO v_season_id
  FROM public.weeks w
  WHERE w.id = NEW.week_id;

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

-- ---------------------------------------------------------------------------
-- Playoff team reuse (separate list from regular season)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_unique_team_per_playoff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id UUID;
BEGIN
  SELECT pr.season_id INTO v_season_id
  FROM public.playoff_rounds pr
  WHERE pr.id = NEW.playoff_round_id;

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

-- ---------------------------------------------------------------------------
-- Players may change only team_id before lock; updated_at is DB-controlled.
-- Commissioners retain broader update rights (results / points).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_regular_pick_player_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_id UUID := public.league_id_for_week(NEW.week_id);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_league_commissioner(v_league_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.week_id IS DISTINCT FROM OLD.week_id
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.result IS DISTINCT FROM OLD.result THEN
    RAISE EXCEPTION 'Players may only change team_id on picks'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- updated_at is always rewritten by set_updated_at; ignore client values.
  NEW.updated_at := now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_playoff_pick_player_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_id UUID := public.league_id_for_playoff_round(NEW.playoff_round_id);
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF public.is_league_commissioner(v_league_id) THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.playoff_round_id IS DISTINCT FROM OLD.playoff_round_id
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
     OR NEW.result IS DISTINCT FROM OLD.result
     OR NEW.points_awarded IS DISTINCT FROM OLD.points_awarded THEN
    RAISE EXCEPTION 'Players may only change team_id on playoff picks'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.updated_at := now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS picks_enforce_player_columns ON public.picks;
CREATE TRIGGER picks_enforce_player_columns
BEFORE UPDATE ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_regular_pick_player_columns();

DROP TRIGGER IF EXISTS playoff_picks_enforce_player_columns ON public.playoff_picks;
CREATE TRIGGER playoff_picks_enforce_player_columns
BEFORE UPDATE ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_playoff_pick_player_columns();

-- Keep result/points triggers; they reinforce commissioner-only scoring edits.
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
     AND NOT public.is_league_commissioner(public.league_id_for_week(NEW.week_id)) THEN
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
       public.league_id_for_playoff_round(NEW.playoff_round_id)
     ) THEN
    RAISE EXCEPTION 'Only commissioners can set pick results'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Replace player pick UPDATE policies: require active membership in USING
-- and WITH CHECK. Players may only reach these while unlocked.
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
