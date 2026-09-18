-- Reveal another player's pick only after that pick's selected game kicks off.
-- Legacy picks without game provenance retain the week-level lock fallback.

DROP POLICY IF EXISTS picks_select_own_or_locked_week ON public.picks;
DROP POLICY IF EXISTS picks_select_own_or_started_game ON public.picks;

CREATE POLICY picks_select_own_or_started_game
ON public.picks
FOR SELECT
TO authenticated
USING (
  public.is_active_league_member(public.league_id_for_week(week_id))
  AND (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.games g
      WHERE g.id = picks.game_id
        AND g.scheduled_kickoff_at <= now()
    )
    OR (game_id IS NULL AND public.week_is_locked(week_id))
  )
);

