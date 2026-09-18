-- Upgrade-path test: reproduce production drift, then re-apply reconciliation.
--
-- Clean db reset alone is insufficient. This test:
-- 1) starts from the fully migrated local schema
-- 2) recreates the post-2B-B / pre-reconciliation drift seen in production
-- 3) re-applies 20260918190000_production_security_reconciliation.sql
-- 4) verifies the intended final catalog and authorization grants
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

-- ---------------------------------------------------------------------------
-- Reproduce production-like drift after Phase 2B-B objects exist
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS picks_enforce_insert_audit ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_update_guards ON public.picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_insert_audit ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_update_guards ON public.playoff_picks;

-- Leave orphaned update-guard functions (as CREATE OR REPLACE from 2B-B would),
-- but remove insert-audit functions to match the missing-object report.
DROP FUNCTION IF EXISTS public.enforce_regular_pick_insert_audit();
DROP FUNCTION IF EXISTS public.enforce_playoff_pick_insert_audit();

CREATE OR REPLACE FUNCTION public.enforce_regular_pick_player_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Legacy stub representing the obsolete production trigger body.
  IF auth.uid() IS NOT NULL THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_playoff_pick_player_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.updated_at := now();
  END IF;
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

GRANT EXECUTE ON FUNCTION public.enforce_unique_team_per_season() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_unique_team_per_playoff() TO PUBLIC;

-- Sanity: drift is present before reconciliation
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'picks'
      AND t.tgname = 'picks_enforce_player_columns' AND NOT t.tgisinternal
  ),
  'drift fixture installed: player_columns trigger present'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'picks'
      AND t.tgname = 'picks_enforce_update_guards' AND NOT t.tgisinternal
  ),
  'drift fixture installed: update_guards trigger absent'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.routine_privileges
    WHERE specific_schema = 'public'
      AND routine_name = 'enforce_unique_team_per_season'
      AND grantee = 'PUBLIC'
      AND privilege_type = 'EXECUTE'
  ),
  'drift fixture installed: PUBLIC EXECUTE on reuse helper'
);

-- ---------------------------------------------------------------------------
-- Apply the forward reconciliation (mirrors
-- 20260918190000_production_security_reconciliation.sql).
-- The test container does not mount ../migrations, so the upgrade path is
-- re-executed inline rather than via \ir.
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
      IF NEW.result_override_reason IS NULL OR btrim(NEW.result_override_reason) = '' THEN
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
      IF NEW.result_override_reason IS NULL OR btrim(NEW.result_override_reason) = '' THEN
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

DROP TRIGGER IF EXISTS picks_enforce_player_columns ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_insert_audit ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_update_guards ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_result_permissions ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_unique_team_per_season ON public.picks;
DROP TRIGGER IF EXISTS picks_enforce_game_and_provenance ON public.picks;

CREATE TRIGGER picks_enforce_insert_audit
BEFORE INSERT ON public.picks
FOR EACH ROW EXECUTE FUNCTION public.enforce_regular_pick_insert_audit();

CREATE TRIGGER picks_enforce_update_guards
BEFORE UPDATE ON public.picks
FOR EACH ROW EXECUTE FUNCTION public.enforce_regular_pick_update_guards();

CREATE TRIGGER picks_enforce_result_permissions
BEFORE UPDATE ON public.picks
FOR EACH ROW EXECUTE FUNCTION public.enforce_regular_pick_result_permissions();

CREATE TRIGGER picks_enforce_unique_team_per_season
BEFORE INSERT OR UPDATE OF team_id, week_id, user_id ON public.picks
FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_team_per_season();

CREATE TRIGGER picks_enforce_game_and_provenance
BEFORE INSERT OR UPDATE OF team_id, week_id, game_id, result, result_source, result_override_reason
ON public.picks
FOR EACH ROW EXECUTE FUNCTION public.enforce_regular_pick_game_and_provenance();

DROP TRIGGER IF EXISTS playoff_picks_enforce_player_columns ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_insert_audit ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_update_guards ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_result_permissions ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_unique_team_per_playoff ON public.playoff_picks;
DROP TRIGGER IF EXISTS playoff_picks_enforce_game_and_provenance ON public.playoff_picks;

CREATE TRIGGER playoff_picks_enforce_insert_audit
BEFORE INSERT ON public.playoff_picks
FOR EACH ROW EXECUTE FUNCTION public.enforce_playoff_pick_insert_audit();

CREATE TRIGGER playoff_picks_enforce_update_guards
BEFORE UPDATE ON public.playoff_picks
FOR EACH ROW EXECUTE FUNCTION public.enforce_playoff_pick_update_guards();

CREATE TRIGGER playoff_picks_enforce_result_permissions
BEFORE UPDATE ON public.playoff_picks
FOR EACH ROW EXECUTE FUNCTION public.enforce_playoff_pick_result_permissions();

CREATE TRIGGER playoff_picks_enforce_unique_team_per_playoff
BEFORE INSERT OR UPDATE OF team_id, playoff_round_id, user_id ON public.playoff_picks
FOR EACH ROW EXECUTE FUNCTION public.enforce_unique_team_per_playoff();

CREATE TRIGGER playoff_picks_enforce_game_and_provenance
BEFORE INSERT OR UPDATE OF
  team_id, playoff_round_id, game_id, result, points_awarded,
  result_source, result_override_reason
ON public.playoff_picks
FOR EACH ROW EXECUTE FUNCTION public.enforce_playoff_pick_game_and_provenance();

DROP FUNCTION IF EXISTS public.enforce_regular_pick_player_columns();
DROP FUNCTION IF EXISTS public.enforce_playoff_pick_player_columns();

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

-- ---------------------------------------------------------------------------
-- Final catalog assertions
-- ---------------------------------------------------------------------------
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname IN (
        'picks_enforce_player_columns',
        'playoff_picks_enforce_player_columns'
      )
  ),
  0,
  'after upgrade: obsolete player_columns triggers removed'
);

SELECT is(
  (
    SELECT string_agg(t.tgname::text || '=' || p.proname::text, ',' ORDER BY t.tgname::text COLLATE "C")
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname = 'picks'
      AND NOT t.tgisinternal
      AND t.tgname IN (
        'picks_enforce_insert_audit',
        'picks_enforce_update_guards',
        'picks_enforce_result_permissions',
        'picks_enforce_unique_team_per_season',
        'picks_enforce_game_and_provenance'
      )
  ),
  'picks_enforce_game_and_provenance=enforce_regular_pick_game_and_provenance,picks_enforce_insert_audit=enforce_regular_pick_insert_audit,picks_enforce_result_permissions=enforce_regular_pick_result_permissions,picks_enforce_unique_team_per_season=enforce_unique_team_per_season,picks_enforce_update_guards=enforce_regular_pick_update_guards',
  'after upgrade: regular security triggers match intended catalog'
);

SELECT is(
  (
    SELECT string_agg(t.tgname::text || '=' || p.proname::text, ',' ORDER BY t.tgname::text COLLATE "C")
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname = 'playoff_picks'
      AND NOT t.tgisinternal
      AND t.tgname IN (
        'playoff_picks_enforce_insert_audit',
        'playoff_picks_enforce_update_guards',
        'playoff_picks_enforce_result_permissions',
        'playoff_picks_enforce_unique_team_per_playoff',
        'playoff_picks_enforce_game_and_provenance'
      )
  ),
  'playoff_picks_enforce_game_and_provenance=enforce_playoff_pick_game_and_provenance,playoff_picks_enforce_insert_audit=enforce_playoff_pick_insert_audit,playoff_picks_enforce_result_permissions=enforce_playoff_pick_result_permissions,playoff_picks_enforce_unique_team_per_playoff=enforce_unique_team_per_playoff,playoff_picks_enforce_update_guards=enforce_playoff_pick_update_guards',
  'after upgrade: playoff security triggers match intended catalog'
);

SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.routine_privileges
    WHERE specific_schema = 'public'
      AND grantee = 'PUBLIC'
      AND privilege_type = 'EXECUTE'
      AND routine_name IN (
        'enforce_unique_team_per_season',
        'enforce_unique_team_per_playoff',
        'enforce_regular_pick_insert_audit',
        'enforce_playoff_pick_insert_audit',
        'enforce_regular_pick_update_guards',
        'enforce_playoff_pick_update_guards',
        'enforce_regular_pick_result_permissions',
        'enforce_playoff_pick_result_permissions',
        'enforce_regular_pick_game_and_provenance',
        'enforce_playoff_pick_game_and_provenance',
        'sync_game_participants',
        'games_maintain_participants'
      )
  ),
  0,
  'after upgrade: PUBLIC EXECUTE revoked from internal helpers'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'enforce_regular_pick_player_columns',
        'enforce_playoff_pick_player_columns'
      )
  ),
  'after upgrade: obsolete player_columns functions dropped'
);

SELECT * FROM finish();
ROLLBACK;
