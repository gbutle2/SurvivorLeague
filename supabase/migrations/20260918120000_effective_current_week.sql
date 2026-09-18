-- Phase 2B-A: database-authoritative effective current regular-season week.
-- Player pick INSERT/UPDATE authorization uses this rule (not stored open status).
-- Do not apply to remote Supabase until explicitly approved.

-- Effective current week for an active season:
-- lowest week_number among weeks that are not locked/final and locks_at > now().
CREATE OR REPLACE FUNCTION public.effective_current_week_id(p_season_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id
  FROM public.weeks w
  INNER JOIN public.seasons s ON s.id = w.season_id
  WHERE w.season_id = p_season_id
    AND s.status = 'active'
    AND w.status NOT IN ('locked', 'final')
    AND w.locks_at > now()
  ORDER BY w.week_number ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.week_is_effective_current(p_week_id UUID)
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
      AND public.effective_current_week_id(w.season_id) IS NOT DISTINCT FROM w.id
  );
$$;

COMMENT ON FUNCTION public.effective_current_week_id(UUID) IS
  'Lowest-numbered active-season week that is not locked/final and locks_at > now().';

COMMENT ON FUNCTION public.week_is_effective_current(UUID) IS
  'True when the week is the singular database-derived effective current week.';

-- Player pick writes: must target the effective current week (implies future deadline).
DROP POLICY IF EXISTS picks_insert_own_before_lock ON public.picks;
CREATE POLICY picks_insert_own_before_lock
ON public.picks
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.week_is_effective_current(week_id)
);

DROP POLICY IF EXISTS picks_update_own_before_lock ON public.picks;
CREATE POLICY picks_update_own_before_lock
ON public.picks
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.week_is_effective_current(week_id)
)
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.week_is_effective_current(week_id)
);

REVOKE ALL ON FUNCTION public.effective_current_week_id(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.week_is_effective_current(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.effective_current_week_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.week_is_effective_current(UUID) TO authenticated;
