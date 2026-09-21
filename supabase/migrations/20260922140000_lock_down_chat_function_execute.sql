-- Lock down EXECUTE on league-chat SECURITY DEFINER functions.
--
-- Project-specific requirement: Supabase default privileges in this project grant
-- EXECUTE on new public functions directly to anon and authenticated (in addition
-- to PUBLIC). REVOKE FROM PUBLIC alone is therefore insufficient — every
-- lockdown must also revoke anon and authenticated, then re-grant only the
-- approved authenticated client RPCs / RLS helpers.
--
-- Does not change global ALTER DEFAULT PRIVILEGES (that needs a repo-wide audit).
-- Triggers and the NFL sync Postgres connection run as a privileged DB role and
-- retain execute without client-role grants.

-- ---------------------------------------------------------------------------
-- Internal-only: revoke PUBLIC + anon + authenticated
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.record_league_event(
  UUID, UUID, UUID, public.league_event_type, UUID, UUID, TEXT, UUID,
  JSONB, JSONB, BOOLEAN, TEXT, BOOLEAN, UUID, public.notification_type,
  TEXT, TEXT, TEXT, JSONB
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_league_event(
  UUID, UUID, UUID, public.league_event_type, UUID, UUID, TEXT, UUID,
  JSONB, JSONB, BOOLEAN, TEXT, BOOLEAN, UUID, public.notification_type,
  TEXT, TEXT, TEXT, JSONB
) FROM anon;
REVOKE ALL ON FUNCTION public.record_league_event(
  UUID, UUID, UUID, public.league_event_type, UUID, UUID, TEXT, UUID,
  JSONB, JSONB, BOOLEAN, TEXT, BOOLEAN, UUID, public.notification_type,
  TEXT, TEXT, TEXT, JSONB
) FROM authenticated;

REVOKE ALL ON FUNCTION public.reveal_eligible_pick_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reveal_eligible_pick_events() FROM anon;
REVOKE ALL ON FUNCTION public.reveal_eligible_pick_events() FROM authenticated;

REVOKE ALL ON FUNCTION public.pick_is_revealed_to_peers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pick_is_revealed_to_peers(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.pick_is_revealed_to_peers(UUID) FROM authenticated;

REVOKE ALL ON FUNCTION public.profile_display_name(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.profile_display_name(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.profile_display_name(UUID) FROM authenticated;

REVOKE ALL ON FUNCTION public.trg_picks_record_league_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_picks_record_league_events() FROM anon;
REVOKE ALL ON FUNCTION public.trg_picks_record_league_events() FROM authenticated;

REVOKE ALL ON FUNCTION public.trg_games_reveal_pick_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_games_reveal_pick_events() FROM anon;
REVOKE ALL ON FUNCTION public.trg_games_reveal_pick_events() FROM authenticated;

REVOKE ALL ON FUNCTION public.trg_weeks_record_league_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_weeks_record_league_events() FROM anon;
REVOKE ALL ON FUNCTION public.trg_weeks_record_league_events() FROM authenticated;

REVOKE ALL ON FUNCTION public.trg_seasons_record_league_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_seasons_record_league_events() FROM anon;
REVOKE ALL ON FUNCTION public.trg_seasons_record_league_events() FROM authenticated;

REVOKE ALL ON FUNCTION public.trg_members_record_league_events() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trg_members_record_league_events() FROM anon;
REVOKE ALL ON FUNCTION public.trg_members_record_league_events() FROM authenticated;

-- ---------------------------------------------------------------------------
-- RLS helper: authenticated needs EXECUTE for policy evaluation; not anon/PUBLIC
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.is_conversation_participant(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_conversation_participant(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.is_conversation_participant(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.is_conversation_participant(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Client-facing RPCs: authenticated only
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.ensure_league_conversation(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_league_conversation(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_league_conversation(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_league_conversation(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.ensure_direct_conversation(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_direct_conversation(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_direct_conversation(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_direct_conversation(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.send_conversation_message(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_conversation_message(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.send_conversation_message(UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.send_conversation_message(UUID, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.edit_own_message(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.edit_own_message(UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.edit_own_message(UUID, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.edit_own_message(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.soft_delete_own_message(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_own_message(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.soft_delete_own_message(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_own_message(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_conversation_read(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_conversation_read(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.mark_conversation_read(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_notification_read(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_notification_read(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.mark_notification_read(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.mark_all_notifications_read(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(UUID) TO authenticated;
