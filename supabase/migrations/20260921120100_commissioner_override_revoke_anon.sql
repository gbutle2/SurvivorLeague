-- Revoke accidental default EXECUTE grants to anon on commissioner override RPCs.
-- Functions already reject unauthenticated callers via auth.uid(); this restores
-- least-privilege grants to match the intended authenticated-only surface.

REVOKE ALL ON FUNCTION public.commissioner_override_pick(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, public.pick_result, INTEGER, UUID
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commissioner_override_pick(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, public.pick_result, INTEGER, UUID
) FROM anon;
GRANT EXECUTE ON FUNCTION public.commissioner_override_pick(
  UUID, UUID, UUID, TEXT, UUID, UUID, TEXT, public.pick_result, INTEGER, UUID
) TO authenticated;

REVOKE ALL ON FUNCTION public.commissioner_list_week_picks(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commissioner_list_week_picks(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.commissioner_list_week_picks(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.commissioner_preview_pick_override(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commissioner_preview_pick_override(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.commissioner_preview_pick_override(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.regular_pick_points_for_result(public.pick_result, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.regular_pick_points_for_result(public.pick_result, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.regular_pick_points_for_result(public.pick_result, UUID) TO authenticated;
