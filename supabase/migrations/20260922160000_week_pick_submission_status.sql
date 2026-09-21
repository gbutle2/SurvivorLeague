-- Privacy-safe weekly pick submission status for active league members.
-- Distinguishes "submitted but hidden by RLS" from "no pick" without leaking
-- team/game/pick identity. Also derives whether the current pick still
-- represents the latest commissioner override (audit provenance, not result_source).
--
-- Forward-only after 20260922150000_week_selector_future_picks.sql.
-- Does not weaken picks RLS. Chat privilege lockdown is preserved.

CREATE OR REPLACE FUNCTION public.week_pick_submission_status(p_week_id UUID)
RETURNS TABLE (
  user_id UUID,
  has_pick BOOLEAN,
  currently_commissioner_overridden BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_requester UUID := auth.uid();
  v_league_id UUID;
BEGIN
  IF v_requester IS NULL THEN
    RAISE EXCEPTION 'Authentication required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT s.league_id
  INTO v_league_id
  FROM public.weeks w
  INNER JOIN public.seasons s ON s.id = w.season_id
  WHERE w.id = p_week_id;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Week not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF NOT public.is_active_league_member(v_league_id) THEN
    RAISE EXCEPTION 'Not an active member of this league'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  WITH active_members AS (
    SELECT lm.user_id
    FROM public.league_members lm
    WHERE lm.league_id = v_league_id
      AND lm.active = true
  ),
  pick_rows AS (
    SELECT
      p.user_id,
      p.team_id,
      p.game_id
    FROM public.picks p
    WHERE p.week_id = p_week_id
  ),
  latest_audits AS (
    SELECT DISTINCT ON (a.target_user_id)
      a.target_user_id,
      a.cleared,
      a.new_team_id,
      a.new_game_id
    FROM public.commissioner_pick_override_audits a
    WHERE a.week_id = p_week_id
    -- overridden_at ties (e.g. same-transaction now()) break with ctid insert order
    ORDER BY a.target_user_id, a.overridden_at DESC, a.ctid DESC
  )
  SELECT
    m.user_id,
    (pr.user_id IS NOT NULL) AS has_pick,
    (
      pr.user_id IS NOT NULL
      AND la.target_user_id IS NOT NULL
      AND la.cleared = false
      AND la.new_team_id IS NOT NULL
      AND pr.team_id = la.new_team_id
      AND pr.game_id IS NOT DISTINCT FROM la.new_game_id
    ) AS currently_commissioner_overridden
  FROM active_members m
  LEFT JOIN pick_rows pr ON pr.user_id = m.user_id
  LEFT JOIN latest_audits la ON la.target_user_id = m.user_id
  ORDER BY m.user_id;
END;
$$;

COMMENT ON FUNCTION public.week_pick_submission_status(UUID) IS
  'Active league members only: one row per active member with has_pick and '
  'currently_commissioner_overridden. Does not expose team, game, pick id, '
  'or audit reason. Override flag is true only when the current pick still '
  'matches the latest non-cleared commissioner override team/game.';

REVOKE ALL ON FUNCTION public.week_pick_submission_status(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.week_pick_submission_status(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.week_pick_submission_status(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.week_pick_submission_status(UUID) TO authenticated;
