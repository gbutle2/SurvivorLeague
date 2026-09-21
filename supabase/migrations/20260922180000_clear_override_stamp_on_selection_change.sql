-- Clear last_commissioner_override_audit_id on any team_id/game_id change,
-- regardless of session identity (player, commissioner, service, null auth.uid()).
-- Forward-only after 20260922170000_commissioner_override_provenance.sql.
--
-- Result-only grading/sync updates preserve the stamp.
-- commissioner_override_pick still stamps the new audit id after insert.

CREATE OR REPLACE FUNCTION public.enforce_regular_pick_update_guards()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Identity-agnostic provenance clear: any selection change drops the stamp.
  -- Commissioner override RPC may clear here on step 1, then re-stamp after audit insert.
  IF NEW.team_id IS DISTINCT FROM OLD.team_id
     OR NEW.game_id IS DISTINCT FROM OLD.game_id THEN
    NEW.last_commissioner_override_audit_id := NULL;
  END IF;

  IF auth.uid() IS NULL THEN
    -- Service/sync path: stamp already cleared above when selection changed;
    -- result-only updates keep the existing stamp.
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.week_id IS DISTINCT FROM OLD.week_id
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Pick identity fields are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.commissioner_override_pick_active() THEN
    NEW.result_source := 'auto';
    NEW.result_override_reason := NULL;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF public.is_league_commissioner(public.league_id_for_week(OLD.week_id)) THEN
    IF NEW.team_id IS DISTINCT FROM OLD.team_id
       OR NEW.result IS DISTINCT FROM OLD.result
       OR NEW.result_source IS DISTINCT FROM OLD.result_source
       OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason
       OR NEW.game_id IS DISTINCT FROM OLD.game_id
       OR NEW.last_commissioner_override_audit_id IS DISTINCT FROM OLD.last_commissioner_override_audit_id THEN
      RAISE EXCEPTION 'Use commissioner_override_pick to change regular-season picks'
        USING ERRCODE = 'insufficient_privilege';
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

  -- Block players from spoofing a provenance stamp when selection is unchanged.
  IF NEW.team_id IS NOT DISTINCT FROM OLD.team_id
     AND NEW.game_id IS NOT DISTINCT FROM OLD.game_id THEN
    NEW.last_commissioner_override_audit_id := OLD.last_commissioner_override_audit_id;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_regular_pick_update_guards() FROM PUBLIC;

COMMENT ON COLUMN public.picks.last_commissioner_override_audit_id IS
  'Set by commissioner_override_pick to the audit that authored the current selection; '
  'cleared whenever team_id or game_id changes (any session). Not client-writable.';

COMMENT ON FUNCTION public.enforce_regular_pick_update_guards() IS
  'Enforces pick update rules. Clears last_commissioner_override_audit_id on any '
  'team_id/game_id change without consulting session identity.';
