-- Allow league commissioners to edit their own unlocked picks like any other
-- owner. Direct mutations of other players' picks still require
-- commissioner_override_pick (defense in depth; RLS already blocks them).
--
-- Pre-kickoff owner edits (including the commissioner) clear
-- last_commissioner_override_audit_id. Started/completed games remain
-- kickoff-locked for everyone except the override RPC.

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

  -- Defense in depth for SECURITY DEFINER callers: other players' picks must
  -- go through commissioner_override_pick. Own-pick updates fall through to
  -- normal player rules (RLS already requires user_id = auth.uid()).
  IF public.is_league_commissioner(public.league_id_for_week(OLD.week_id))
     AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
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

COMMENT ON FUNCTION public.enforce_regular_pick_update_guards() IS
  'Enforces pick update rules. Clears last_commissioner_override_audit_id on any '
  'team_id/game_id change. Commissioners editing their own unlocked picks follow '
  'player rules; mutating another player requires commissioner_override_pick.';

CREATE OR REPLACE FUNCTION public.enforce_regular_pick_game_and_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game public.games%ROWTYPE;
  v_is_commissioner BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE'
     AND auth.uid() IS NOT NULL
     AND NEW.week_id IS DISTINCT FROM OLD.week_id THEN
    RETURN NEW;
  END IF;

  IF public.commissioner_override_pick_active() THEN
    -- RPC already resolved game/result; still refuse client spoof of game_id.
    IF NEW.game_id IS NULL THEN
      RAISE EXCEPTION 'Commissioner override requires derived game_id'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.result_source := 'auto';
    NEW.result_override_reason := NULL;
    RETURN NEW;
  END IF;

  v_game := public.game_for_regular_team(
    public.season_year_for_week(NEW.week_id),
    public.week_number_for_week(NEW.week_id),
    NEW.team_id
  );

  IF v_game.id IS NULL THEN
    RAISE EXCEPTION 'No scheduled non-canceled game for that team in this week'
      USING ERRCODE = 'check_violation';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    v_is_commissioner := public.is_league_commissioner(
      public.league_id_for_week(
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.week_id ELSE NEW.week_id END
      )
    );

    NEW.game_id := v_game.id;

    IF TG_OP = 'INSERT' THEN
      NEW.result := 'pending';
      NEW.result_source := 'auto';
      NEW.result_override_reason := NULL;
      RETURN NEW;
    END IF;

    -- Defense in depth: other players' picks require the override RPC.
    -- Own-pick updates (including the commissioner) use player provenance rules.
    IF v_is_commissioner AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'Use commissioner_override_pick to change regular-season picks'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    IF NEW.result_source IS DISTINCT FROM OLD.result_source
       OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
      RAISE EXCEPTION 'Players cannot set result_source or result_override_reason'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.result_source := OLD.result_source;
    NEW.result_override_reason := OLD.result_override_reason;
    RETURN NEW;
  END IF;

  IF NEW.game_id IS NULL THEN
    NEW.game_id := v_game.id;
  ELSIF NEW.game_id IS DISTINCT FROM v_game.id THEN
    RAISE EXCEPTION 'game_id must match the scheduled game for team/week'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_regular_pick_game_and_provenance() FROM PUBLIC;

COMMENT ON FUNCTION public.enforce_regular_pick_game_and_provenance() IS
  'Derives game_id and blocks authenticated clients from controlling result provenance. '
  'Commissioners may edit their own picks like players; other players require '
  'commissioner_override_pick.';
