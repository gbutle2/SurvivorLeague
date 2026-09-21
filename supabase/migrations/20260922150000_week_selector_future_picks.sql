-- Forward-only: allow player picks on any scheduled regular week that is not
-- administratively locked/final. Per-team kickoff remains the mutation lock.
--
-- Does NOT drop weeks_one_open_per_season_idx (commissioner admin status only).
-- Does NOT change effective_current_week_id (still used as the UI default week).
--
-- Project privilege rule: revoke PUBLIC + anon + authenticated, then grant only
-- what authenticated clients need for RLS evaluation.

CREATE OR REPLACE FUNCTION public.week_allows_player_picks(p_week_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.weeks w
    INNER JOIN public.seasons s ON s.id = w.season_id
    WHERE w.id = p_week_id
      AND s.status = 'active'
      AND w.status NOT IN (
        'locked'::public.week_status,
        'final'::public.week_status
      )
  );
$$;

COMMENT ON FUNCTION public.week_allows_player_picks(UUID) IS
  'Player pick mutations allowed when season is active and week status is not locked/final. '
  'Kickoff unlock is enforced separately via pick_team_plays_unlocked_in_week.';

REVOKE ALL ON FUNCTION public.week_allows_player_picks(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.week_allows_player_picks(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.week_allows_player_picks(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.week_allows_player_picks(UUID) TO authenticated;

-- Replace effective-current week gate with schedule-week pickability.
DROP POLICY IF EXISTS picks_insert_own_before_lock ON public.picks;
CREATE POLICY picks_insert_own_before_lock
ON public.picks
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND result_source = 'auto'
  AND result_override_reason IS NULL
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.season_is_active_for_week(week_id)
  AND public.week_allows_player_picks(week_id)
  AND public.pick_team_plays_unlocked_in_week(week_id, team_id)
);

DROP POLICY IF EXISTS picks_update_own_before_lock ON public.picks;
CREATE POLICY picks_update_own_before_lock
ON public.picks
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.season_is_active_for_week(week_id)
  AND public.week_allows_player_picks(week_id)
  AND public.pick_team_plays_unlocked_in_week(week_id, team_id)
)
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND result_source = 'auto'
  AND result_override_reason IS NULL
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.season_is_active_for_week(week_id)
  AND public.week_allows_player_picks(week_id)
  AND public.pick_team_plays_unlocked_in_week(week_id, team_id)
);
