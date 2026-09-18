-- Production security reconciliation (forward-only).
--
-- Production recorded 20260916130000 as applied but still has legacy
-- picks_enforce_player_columns / playoff_picks_enforce_player_columns and
-- lacks insert-audit + update-guards triggers/functions. PUBLIC EXECUTE also
-- remained on team-reuse SECURITY DEFINER helpers.
--
-- This migration reconciles catalog state to the intended post-Phase-2B-B
-- security model without editing already-applied migration files.

-- ---------------------------------------------------------------------------
-- Regular pick functions (intended final definitions)
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

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.week_id IS DISTINCT FROM OLD.week_id
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Pick identity fields are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.is_league_commissioner(public.league_id_for_week(OLD.week_id)) THEN
    IF NEW.result IS DISTINCT FROM OLD.result
       OR NEW.result_source IS DISTINCT FROM OLD.result_source
       OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
      IF NEW.result_source IS DISTINCT FROM 'commissioner'::public.pick_result_source THEN
        RAISE EXCEPTION 'Commissioner result changes require result_source = commissioner'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.result_override_reason IS NULL
         OR btrim(NEW.result_override_reason) = '' THEN
        RAISE EXCEPTION 'Commissioner override requires a nonblank reason'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.result_source := 'commissioner';
      NEW.result_override_reason := btrim(NEW.result_override_reason);
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.result IS DISTINCT FROM OLD.result
     OR NEW.result_source IS DISTINCT FROM OLD.result_source
     OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
    RAISE EXCEPTION 'Players may only change team_id on picks'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

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

-- ---------------------------------------------------------------------------
-- Playoff pick functions (intended final definitions)
-- ---------------------------------------------------------------------------
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
    IF NEW.result IS DISTINCT FROM OLD.result
       OR NEW.points_awarded IS DISTINCT FROM OLD.points_awarded
       OR NEW.result_source IS DISTINCT FROM OLD.result_source
       OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
      IF NEW.result_source IS DISTINCT FROM 'commissioner'::public.pick_result_source THEN
        RAISE EXCEPTION 'Commissioner result changes require result_source = commissioner'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.result_override_reason IS NULL
         OR btrim(NEW.result_override_reason) = '' THEN
        RAISE EXCEPTION 'Commissioner override requires a nonblank reason'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.result_source := 'commissioner';
      NEW.result_override_reason := btrim(NEW.result_override_reason);
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.result IS DISTINCT FROM OLD.result
     OR NEW.points_awarded IS DISTINCT FROM OLD.points_awarded
     OR NEW.result_source IS DISTINCT FROM OLD.result_source
     OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
    RAISE EXCEPTION 'Players may only change team_id on playoff picks'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.updated_at := now();
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
-- Regular pick triggers: remove obsolete, install intended set exactly once
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS picks_enforce_player_columns ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_insert_audit ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_update_guards ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_result_permissions ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_unique_team_per_season ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_game_and_provenance ON public.picks;

CREATE TRIGGER picks_enforce_insert_audit
BEFORE INSERT ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_regular_pick_insert_audit();

CREATE TRIGGER picks_enforce_update_guards
BEFORE UPDATE ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_regular_pick_update_guards();

CREATE TRIGGER picks_enforce_result_permissions
BEFORE UPDATE ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_regular_pick_result_permissions();

CREATE TRIGGER picks_enforce_unique_team_per_season
BEFORE INSERT OR UPDATE OF team_id, week_id, user_id
ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_unique_team_per_season();

CREATE TRIGGER picks_enforce_game_and_provenance
BEFORE INSERT OR UPDATE OF team_id, week_id, game_id, result, result_source, result_override_reason
ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_regular_pick_game_and_provenance();

-- ---------------------------------------------------------------------------
-- Playoff pick triggers
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS playoff_picks_enforce_player_columns ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_insert_audit ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_update_guards ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_result_permissions ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_unique_team_per_playoff ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_game_and_provenance ON public.playoff_picks;

CREATE TRIGGER playoff_picks_enforce_insert_audit
BEFORE INSERT ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_playoff_pick_insert_audit();

CREATE TRIGGER playoff_picks_enforce_update_guards
BEFORE UPDATE ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_playoff_pick_update_guards();

CREATE TRIGGER playoff_picks_enforce_result_permissions
BEFORE UPDATE ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_playoff_pick_result_permissions();

CREATE TRIGGER playoff_picks_enforce_unique_team_per_playoff
BEFORE INSERT OR UPDATE OF team_id, playoff_round_id, user_id
ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_unique_team_per_playoff();

CREATE TRIGGER playoff_picks_enforce_game_and_provenance
BEFORE INSERT OR UPDATE OF
  team_id, playoff_round_id, game_id, result, points_awarded,
  result_source, result_override_reason
ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_playoff_pick_game_and_provenance();

DROP FUNCTION IF EXISTS public.enforce_regular_pick_player_columns();
DROP FUNCTION IF EXISTS public.enforce_playoff_pick_player_columns();

-- ---------------------------------------------------------------------------
-- Revoke PUBLIC / authenticated execute on internal SECURITY DEFINER helpers
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.enforce_unique_team_per_season() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_unique_team_per_playoff() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_regular_pick_insert_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_playoff_pick_insert_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_regular_pick_update_guards() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_playoff_pick_update_guards() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_regular_pick_result_permissions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_playoff_pick_result_permissions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_regular_pick_game_and_provenance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_playoff_pick_game_and_provenance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_game_participants(public.games) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.games_maintain_participants() FROM PUBLIC;

REVOKE ALL ON FUNCTION public.enforce_unique_team_per_season() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_unique_team_per_playoff() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_regular_pick_insert_audit() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_playoff_pick_insert_audit() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_regular_pick_update_guards() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_playoff_pick_update_guards() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_regular_pick_result_permissions() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_playoff_pick_result_permissions() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_regular_pick_game_and_provenance() FROM authenticated;
REVOKE ALL ON FUNCTION public.enforce_playoff_pick_game_and_provenance() FROM authenticated;
REVOKE ALL ON FUNCTION public.sync_game_participants(public.games) FROM authenticated;
REVOKE ALL ON FUNCTION public.games_maintain_participants() FROM authenticated;

COMMENT ON FUNCTION public.enforce_regular_pick_update_guards() IS
  'Authenticated pick update guards: immutable identity; commissioner override provenance; players team_id only.';
COMMENT ON FUNCTION public.enforce_playoff_pick_update_guards() IS
  'Authenticated playoff pick update guards: immutable identity; commissioner override provenance; players team_id only.';
