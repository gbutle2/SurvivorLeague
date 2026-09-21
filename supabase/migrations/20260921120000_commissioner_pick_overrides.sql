-- Commissioner pick overrides: authoritative RPC + immutable audit trail.
-- Forward-only. Does not rewrite existing picks.
-- Constrains direct commissioner result/team mutation on regular picks;
-- only commissioner_override_pick may create/change/clear regular picks for others.

-- ---------------------------------------------------------------------------
-- Audit table
-- ---------------------------------------------------------------------------
CREATE TABLE public.commissioner_pick_override_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commissioner_user_id UUID NOT NULL REFERENCES public.profiles (id),
  target_user_id UUID NOT NULL REFERENCES public.profiles (id),
  league_id UUID NOT NULL REFERENCES public.leagues (id),
  season_id UUID NOT NULL REFERENCES public.seasons (id),
  week_id UUID NOT NULL REFERENCES public.weeks (id),
  week_number INTEGER NOT NULL,
  previous_team_id UUID NULL REFERENCES public.teams (id),
  previous_game_id UUID NULL REFERENCES public.games (id),
  previous_result public.pick_result NULL,
  previous_points INTEGER NULL,
  new_team_id UUID NULL REFERENCES public.teams (id),
  new_game_id UUID NULL REFERENCES public.games (id),
  new_result public.pick_result NULL,
  new_points INTEGER NULL,
  cleared BOOLEAN NOT NULL DEFAULT false,
  reason TEXT NOT NULL,
  overridden_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT commissioner_pick_override_audits_reason_nonblank
    CHECK (btrim(reason) <> ''),
  CONSTRAINT commissioner_pick_override_audits_week_number_positive
    CHECK (week_number > 0),
  CONSTRAINT commissioner_pick_override_audits_points_nonnegative
    CHECK (
      (previous_points IS NULL OR previous_points >= 0)
      AND (new_points IS NULL OR new_points >= 0)
    )
);

CREATE INDEX commissioner_pick_override_audits_league_idx
  ON public.commissioner_pick_override_audits (league_id, overridden_at DESC);

CREATE INDEX commissioner_pick_override_audits_week_idx
  ON public.commissioner_pick_override_audits (week_id, target_user_id, overridden_at DESC);

ALTER TABLE public.commissioner_pick_override_audits ENABLE ROW LEVEL SECURITY;

-- No INSERT/UPDATE/DELETE policies for authenticated: only SECURITY DEFINER RPC writes.
CREATE POLICY commissioner_pick_override_audits_select_commissioner
ON public.commissioner_pick_override_audits
FOR SELECT
TO authenticated
USING (
  public.is_league_commissioner(league_id)
);

REVOKE ALL ON TABLE public.commissioner_pick_override_audits FROM PUBLIC;
REVOKE ALL ON TABLE public.commissioner_pick_override_audits FROM anon;
REVOKE ALL ON TABLE public.commissioner_pick_override_audits FROM authenticated;
GRANT SELECT ON TABLE public.commissioner_pick_override_audits TO authenticated;

-- Immutable at the trigger layer (in addition to privilege/RLS lockdown).
CREATE OR REPLACE FUNCTION public.reject_commissioner_pick_override_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.commissioner_override_pick_active() AND TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Commissioner pick override audits are immutable'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

REVOKE ALL ON FUNCTION public.reject_commissioner_pick_override_audit_mutation() FROM PUBLIC;

CREATE TRIGGER commissioner_pick_override_audits_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.commissioner_pick_override_audits
FOR EACH ROW
EXECUTE FUNCTION public.reject_commissioner_pick_override_audit_mutation();

-- ---------------------------------------------------------------------------
-- Session flag helpers (transaction-local)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commissioner_override_pick_active()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(current_setting('app.commissioner_override_pick', true), '') = '1';
$$;

REVOKE ALL ON FUNCTION public.commissioner_override_pick_active() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Regular weekly points from result (canonical scoring; not stored on picks)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regular_pick_points_for_result(
  p_result public.pick_result,
  p_season_id UUID
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_result = 'win' THEN coalesce(
      (
        SELECT sr.correct_regular_pick_points
        FROM public.scoring_rules sr
        WHERE sr.season_id = p_season_id
      ),
      1
    )
    ELSE 0
  END;
$$;

REVOKE ALL ON FUNCTION public.regular_pick_points_for_result(public.pick_result, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regular_pick_points_for_result(public.pick_result, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Derive result from authoritative game row (no client trust)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.derive_regular_pick_result_from_game(
  p_game public.games,
  p_team_id UUID
)
RETURNS public.pick_result
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_game.id IS NULL THEN
    RAISE EXCEPTION 'No scheduled game for that team in this week'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_game.status = 'canceled' THEN
    RAISE EXCEPTION 'Cannot override pick for a canceled game'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_game.status = 'postponed' THEN
    RAISE EXCEPTION 'Cannot override pick for a postponed game until schedule status is defined'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_game.status = 'final' THEN
    IF p_game.home_score IS NULL OR p_game.away_score IS NULL THEN
      RAISE EXCEPTION 'Final game is missing authoritative scores'
        USING ERRCODE = 'check_violation';
    END IF;
    IF p_game.winner_team_id IS NULL THEN
      RETURN 'tie'::public.pick_result;
    END IF;
    IF p_game.winner_team_id = p_team_id THEN
      RETURN 'win'::public.pick_result;
    END IF;
    RETURN 'loss'::public.pick_result;
  END IF;

  IF p_game.status IN ('scheduled', 'in_progress') THEN
    RETURN 'pending'::public.pick_result;
  END IF;

  RAISE EXCEPTION 'Undefined game status for commissioner override: %', p_game.status
    USING ERRCODE = 'check_violation';
END;
$$;

REVOKE ALL ON FUNCTION public.derive_regular_pick_result_from_game(public.games, UUID) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Resolve exactly one non-canceled game for team/week
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regular_team_game_for_override(
  p_season_year INTEGER,
  p_week_number INTEGER,
  p_team_id UUID
)
RETURNS public.games
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_game public.games%ROWTYPE;
BEGIN
  SELECT count(*)::integer INTO v_count
  FROM public.games g
  WHERE g.season_year = p_season_year
    AND g.season_type = 'regular'
    AND g.regular_week_number = p_week_number
    AND g.status <> 'canceled'
    AND (g.home_team_id = p_team_id OR g.away_team_id = p_team_id);

  IF v_count = 0 THEN
    RAISE EXCEPTION 'That team is on bye or not scheduled this week'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_count > 1 THEN
    RAISE EXCEPTION 'Ambiguous schedule: multiple games for that team in this week'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT g.* INTO v_game
  FROM public.games g
  WHERE g.season_year = p_season_year
    AND g.season_type = 'regular'
    AND g.regular_week_number = p_week_number
    AND g.status <> 'canceled'
    AND (g.home_team_id = p_team_id OR g.away_team_id = p_team_id);

  RETURN v_game;
END;
$$;

REVOKE ALL ON FUNCTION public.regular_team_game_for_override(INTEGER, INTEGER, UUID) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Constrain direct commissioner mutations; allow RPC via session flag
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_regular_pick_insert_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF public.commissioner_override_pick_active() THEN
      -- Truthful creation time for new historical picks; do not falsify.
      IF NEW.submitted_at IS NULL THEN
        NEW.submitted_at := now();
      END IF;
      NEW.updated_at := now();
      RETURN NEW;
    END IF;
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

  IF public.commissioner_override_pick_active() THEN
    -- Authoritative RPC sets team/result; reason lives in audit only.
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
       OR NEW.game_id IS DISTINCT FROM OLD.game_id THEN
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

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

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

    IF v_is_commissioner THEN
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

-- Drop broad commissioner UPDATE/DELETE policies — mutations go through RPC.
DROP POLICY IF EXISTS picks_update_commissioner ON public.picks;
DROP POLICY IF EXISTS picks_delete_commissioner ON public.picks;

-- ---------------------------------------------------------------------------
-- Authoritative commissioner override RPC
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commissioner_override_pick(
  p_target_user_id UUID,
  p_week_id UUID,
  p_team_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_submitted_requester_id UUID DEFAULT NULL,
  p_submitted_league_id UUID DEFAULT NULL,
  p_submitted_role TEXT DEFAULT NULL,
  p_submitted_result public.pick_result DEFAULT NULL,
  p_submitted_points INTEGER DEFAULT NULL,
  p_submitted_game_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_league_id UUID;
  v_season_id UUID;
  v_season_year INTEGER;
  v_season_status public.season_status;
  v_week_number INTEGER;
  v_regular_week_count INTEGER;
  v_reason TEXT := btrim(coalesce(p_reason, ''));
  v_existing public.picks%ROWTYPE;
  v_game public.games%ROWTYPE;
  v_new_result public.pick_result;
  v_prev_points INTEGER;
  v_new_points INTEGER;
  v_audit_id UUID;
  v_conflict_week INTEGER;
  v_lock_key BIGINT;
  v_pick_id UUID;
BEGIN
  -- Ignore any client-submitted identity / scoring fields.
  IF p_submitted_requester_id IS NOT NULL
     OR p_submitted_league_id IS NOT NULL
     OR p_submitted_role IS NOT NULL
     OR p_submitted_result IS NOT NULL
     OR p_submitted_points IS NOT NULL
     OR p_submitted_game_id IS NOT NULL THEN
    NULL; -- intentionally discarded
  END IF;

  IF v_requester IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_reason = '' THEN
    RAISE EXCEPTION 'Override reason is required'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT s.league_id, s.id, s.year, s.status, s.regular_week_count, w.week_number
  INTO v_league_id, v_season_id, v_season_year, v_season_status, v_regular_week_count, v_week_number
  FROM public.weeks w
  INNER JOIN public.seasons s ON s.id = w.season_id
  WHERE w.id = p_week_id;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Week not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.is_league_commissioner(v_league_id) THEN
    RAISE EXCEPTION 'Only an active league commissioner may override picks'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_season_status IS DISTINCT FROM 'active'::public.season_status THEN
    RAISE EXCEPTION 'Season is not active'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_week_number < 1 OR v_week_number > v_regular_week_count THEN
    RAISE EXCEPTION 'Week is outside the regular season'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.league_members lm
    WHERE lm.league_id = v_league_id
      AND lm.user_id = p_target_user_id
      AND lm.active = true
  ) THEN
    RAISE EXCEPTION 'Target is not an active member of this league'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Serialize per player+season for reuse safety (covers clear + set races).
  v_lock_key := hashtextextended(
    'commissioner_override/' || v_season_id::text || '/' || p_target_user_id::text,
    0
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT p.* INTO v_existing
  FROM public.picks p
  WHERE p.week_id = p_week_id
    AND p.user_id = p_target_user_id
  FOR UPDATE;

  IF v_existing.id IS NOT NULL THEN
    v_prev_points := public.regular_pick_points_for_result(v_existing.result, v_season_id);
  END IF;

  -- Resolve schedule/reuse before enabling the override flag so failed
  -- validations never leave the transaction-local flag set.
  IF p_team_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.teams t WHERE t.id = p_team_id AND t.active = true
    ) THEN
      RAISE EXCEPTION 'Team not found or inactive'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT w.week_number INTO v_conflict_week
    FROM public.picks p
    INNER JOIN public.weeks w ON w.id = p.week_id
    WHERE p.user_id = p_target_user_id
      AND p.team_id = p_team_id
      AND w.season_id = v_season_id
      AND p.week_id IS DISTINCT FROM p_week_id
    LIMIT 1;

    IF v_conflict_week IS NOT NULL THEN
      RAISE EXCEPTION 'Team already used by this player in week %', v_conflict_week
        USING ERRCODE = 'check_violation',
              DETAIL = format('conflicting_week_number=%s', v_conflict_week);
    END IF;

    v_game := public.regular_team_game_for_override(v_season_year, v_week_number, p_team_id);
    v_new_result := public.derive_regular_pick_result_from_game(v_game, p_team_id);
    v_new_points := public.regular_pick_points_for_result(v_new_result, v_season_id);
  ELSIF v_existing.id IS NULL THEN
    RAISE EXCEPTION 'No pick to clear for this player and week'
      USING ERRCODE = 'no_data_found';
  END IF;

  BEGIN
    PERFORM set_config('app.commissioner_override_pick', '1', true);

    IF p_team_id IS NULL THEN
      DELETE FROM public.picks WHERE id = v_existing.id;

      INSERT INTO public.commissioner_pick_override_audits (
        commissioner_user_id, target_user_id, league_id, season_id, week_id, week_number,
        previous_team_id, previous_game_id, previous_result, previous_points,
        new_team_id, new_game_id, new_result, new_points, cleared, reason
      ) VALUES (
        v_requester, p_target_user_id, v_league_id, v_season_id, p_week_id, v_week_number,
        v_existing.team_id, v_existing.game_id, v_existing.result, v_prev_points,
        NULL, NULL, NULL, NULL, true, v_reason
      )
      RETURNING id INTO v_audit_id;

      PERFORM set_config('app.commissioner_override_pick', '', true);

      RETURN jsonb_build_object(
        'audit_id', v_audit_id,
        'cleared', true,
        'pick_id', NULL,
        'week_id', p_week_id,
        'user_id', p_target_user_id,
        'team_id', NULL,
        'game_id', NULL,
        'result', NULL,
        'points', 0,
        'week_number', v_week_number
      );
    END IF;

    IF v_existing.id IS NOT NULL THEN
      UPDATE public.picks
      SET team_id = p_team_id,
          game_id = v_game.id,
          result = v_new_result,
          result_source = 'auto',
          result_override_reason = NULL,
          updated_at = now()
      WHERE id = v_existing.id
      RETURNING id INTO v_pick_id;

      IF v_pick_id IS NULL THEN
        RAISE EXCEPTION 'Pick update failed'
          USING ERRCODE = 'data_exception';
      END IF;
    ELSE
      INSERT INTO public.picks (
        week_id, user_id, team_id, game_id, result, result_source, result_override_reason
      ) VALUES (
        p_week_id, p_target_user_id, p_team_id, v_game.id, v_new_result, 'auto', NULL
      )
      RETURNING id INTO v_pick_id;

      IF v_pick_id IS NULL THEN
        RAISE EXCEPTION 'Pick insert failed'
          USING ERRCODE = 'data_exception';
      END IF;
    END IF;

    INSERT INTO public.commissioner_pick_override_audits (
      commissioner_user_id, target_user_id, league_id, season_id, week_id, week_number,
      previous_team_id, previous_game_id, previous_result, previous_points,
      new_team_id, new_game_id, new_result, new_points, cleared, reason
    ) VALUES (
      v_requester, p_target_user_id, v_league_id, v_season_id, p_week_id, v_week_number,
      v_existing.team_id, v_existing.game_id, v_existing.result, v_prev_points,
      p_team_id, v_game.id, v_new_result, v_new_points, false, v_reason
    )
    RETURNING id INTO v_audit_id;

    PERFORM set_config('app.commissioner_override_pick', '', true);

    RETURN jsonb_build_object(
      'audit_id', v_audit_id,
      'cleared', false,
      'pick_id', v_pick_id,
      'week_id', p_week_id,
      'user_id', p_target_user_id,
      'team_id', p_team_id,
      'game_id', v_game.id,
      'result', v_new_result,
      'points', v_new_points,
      'week_number', v_week_number,
      'game_status', v_game.status
    );
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM set_config('app.commissioner_override_pick', '', true);
      RAISE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.commissioner_override_pick(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, public.pick_result, INTEGER, UUID
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commissioner_override_pick(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, public.pick_result, INTEGER, UUID
) TO authenticated;

-- ---------------------------------------------------------------------------
-- Commissioner-only read of all league picks for a week (incl. unstarted)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commissioner_list_week_picks(p_week_id UUID)
RETURNS TABLE (
  user_id UUID,
  display_name TEXT,
  pick_id UUID,
  team_id UUID,
  team_abbreviation TEXT,
  team_city TEXT,
  team_name TEXT,
  game_id UUID,
  result public.pick_result,
  points INTEGER,
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  last_override_at TIMESTAMPTZ,
  last_override_reason TEXT,
  last_override_by UUID,
  used_elsewhere JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_id UUID;
  v_season_id UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT s.league_id, s.id
  INTO v_league_id, v_season_id
  FROM public.weeks w
  INNER JOIN public.seasons s ON s.id = w.season_id
  WHERE w.id = p_week_id;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Week not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.is_league_commissioner(v_league_id) THEN
    RAISE EXCEPTION 'Only an active league commissioner may list all week picks'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT
    lm.user_id,
    pr.display_name,
    p.id AS pick_id,
    p.team_id,
    t.abbreviation AS team_abbreviation,
    t.city AS team_city,
    t.name AS team_name,
    p.game_id,
    p.result,
    CASE
      WHEN p.id IS NULL THEN 0
      ELSE public.regular_pick_points_for_result(p.result, v_season_id)
    END AS points,
    p.submitted_at,
    p.updated_at,
    a.overridden_at AS last_override_at,
    a.reason AS last_override_reason,
    a.commissioner_user_id AS last_override_by,
    coalesce(u.used_elsewhere, '[]'::jsonb) AS used_elsewhere
  FROM public.league_members lm
  INNER JOIN public.profiles pr ON pr.id = lm.user_id
  LEFT JOIN public.picks p
    ON p.user_id = lm.user_id
   AND p.week_id = p_week_id
  LEFT JOIN public.teams t ON t.id = p.team_id
  LEFT JOIN LATERAL (
    SELECT aud.overridden_at, aud.reason, aud.commissioner_user_id
    FROM public.commissioner_pick_override_audits aud
    WHERE aud.week_id = p_week_id
      AND aud.target_user_id = lm.user_id
    ORDER BY aud.overridden_at DESC
    LIMIT 1
  ) a ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
      jsonb_build_object(
        'team_id', op.team_id,
        'week_number', ow.week_number,
        'abbreviation', ot.abbreviation
      )
      ORDER BY ow.week_number
    ) AS used_elsewhere
    FROM public.picks op
    INNER JOIN public.weeks ow ON ow.id = op.week_id
    INNER JOIN public.teams ot ON ot.id = op.team_id
    WHERE op.user_id = lm.user_id
      AND ow.season_id = v_season_id
      AND op.week_id IS DISTINCT FROM p_week_id
  ) u ON true
  WHERE lm.league_id = v_league_id
    AND lm.active = true
  ORDER BY pr.display_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.commissioner_list_week_picks(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commissioner_list_week_picks(UUID) TO authenticated;

-- Preview derivation for confirmation UI (no mutation)
CREATE OR REPLACE FUNCTION public.commissioner_preview_pick_override(
  p_week_id UUID,
  p_team_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league_id UUID;
  v_season_id UUID;
  v_season_year INTEGER;
  v_week_number INTEGER;
  v_game public.games%ROWTYPE;
  v_result public.pick_result;
  v_points INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT s.league_id, s.id, s.year, w.week_number
  INTO v_league_id, v_season_id, v_season_year, v_week_number
  FROM public.weeks w
  INNER JOIN public.seasons s ON s.id = w.season_id
  WHERE w.id = p_week_id;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Week not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.is_league_commissioner(v_league_id) THEN
    RAISE EXCEPTION 'Only an active league commissioner may preview overrides'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_team_id IS NULL THEN
    RETURN jsonb_build_object(
      'team_id', NULL,
      'game_id', NULL,
      'result', NULL,
      'points', 0,
      'game_status', NULL,
      'kickoff_passed', false
    );
  END IF;

  v_game := public.regular_team_game_for_override(v_season_year, v_week_number, p_team_id);
  v_result := public.derive_regular_pick_result_from_game(v_game, p_team_id);
  v_points := public.regular_pick_points_for_result(v_result, v_season_id);

  RETURN jsonb_build_object(
    'team_id', p_team_id,
    'game_id', v_game.id,
    'result', v_result,
    'points', v_points,
    'game_status', v_game.status,
    'kickoff_passed', v_game.scheduled_kickoff_at <= now(),
    'scheduled_kickoff_at', v_game.scheduled_kickoff_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.commissioner_preview_pick_override(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commissioner_preview_pick_override(UUID, UUID) TO authenticated;
