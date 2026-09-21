-- Privilege lockdown regression for league-chat SECURITY DEFINER functions.
-- Run: npm run test:db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

CREATE SCHEMA IF NOT EXISTS tests;

CREATE OR REPLACE FUNCTION tests.authenticate_as(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, tests
AS $$
BEGIN
  EXECUTE 'SET ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', p_user_id::text, 'role', 'authenticated')::text,
    true
  );
END;
$$;

CREATE OR REPLACE FUNCTION tests.clear_auth()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, tests
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'RESET ROLE';
END;
$$;

CREATE OR REPLACE FUNCTION tests.set_anon()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, tests
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET ROLE anon';
END;
$$;

GRANT USAGE ON SCHEMA tests TO authenticated;
GRANT USAGE ON SCHEMA tests TO anon;
GRANT EXECUTE ON FUNCTION tests.authenticate_as(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION tests.clear_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION tests.clear_auth() TO anon;
GRANT EXECUTE ON FUNCTION tests.set_anon() TO authenticated;
GRANT EXECUTE ON FUNCTION tests.set_anon() TO anon;

SELECT plan(37);
SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Catalog privilege assertions (exact intended matrix)
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE chat_priv_oids AS
SELECT p.proname, p.oid
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'record_league_event',
    'reveal_eligible_pick_events',
    'pick_is_revealed_to_peers',
    'profile_display_name',
    'trg_picks_record_league_events',
    'trg_games_reveal_pick_events',
    'trg_weeks_record_league_events',
    'trg_seasons_record_league_events',
    'trg_members_record_league_events',
    'is_conversation_participant',
    'ensure_league_conversation',
    'ensure_direct_conversation',
    'send_conversation_message',
    'edit_own_message',
    'soft_delete_own_message',
    'mark_conversation_read',
    'mark_notification_read',
    'mark_all_notifications_read'
  );

SELECT is(
  (SELECT count(*)::int FROM chat_priv_oids),
  18,
  'all chat functions from 20260922120000 are present'
);

-- Internal-only: no PUBLIC / anon / authenticated execute
SELECT ok(
  NOT has_function_privilege('public', oid, 'EXECUTE')
  AND NOT has_function_privilege('anon', oid, 'EXECUTE')
  AND NOT has_function_privilege('authenticated', oid, 'EXECUTE'),
  'internal ' || proname || ' not executable by PUBLIC/anon/authenticated'
)
FROM chat_priv_oids
WHERE proname IN (
  'record_league_event',
  'reveal_eligible_pick_events',
  'pick_is_revealed_to_peers',
  'profile_display_name',
  'trg_picks_record_league_events',
  'trg_games_reveal_pick_events',
  'trg_weeks_record_league_events',
  'trg_seasons_record_league_events',
  'trg_members_record_league_events'
);

-- Client RPCs + RLS helper: authenticated yes; anon/PUBLIC no
SELECT ok(
  has_function_privilege('authenticated', oid, 'EXECUTE')
  AND NOT has_function_privilege('anon', oid, 'EXECUTE')
  AND NOT has_function_privilege('public', oid, 'EXECUTE'),
  'client/RLS ' || proname || ' executable by authenticated only'
)
FROM chat_priv_oids
WHERE proname IN (
  'is_conversation_participant',
  'ensure_league_conversation',
  'ensure_direct_conversation',
  'send_conversation_message',
  'edit_own_message',
  'soft_delete_own_message',
  'mark_conversation_read',
  'mark_notification_read',
  'mark_all_notifications_read'
);

-- ---------------------------------------------------------------------------
-- Behavioral: direct RPC denial + trusted postgres path + RLS still works
-- ---------------------------------------------------------------------------

CREATE TEMP TABLE priv_ids (
  p1 UUID, p2 UUID, outsider UUID, league_a UUID, season_a UUID, week_a UUID,
  team_buf UUID, conv_a UUID, dm_a UUID
);

GRANT SELECT, UPDATE ON priv_ids TO authenticated;
GRANT SELECT ON priv_ids TO anon;

INSERT INTO priv_ids (p1, p2, outsider, league_a, season_a, week_a) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab02',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb91',
  'cccccccc-cccc-cccc-cccc-cccccccccc91',
  'dddddddd-dddd-dddd-dddd-dddddddddd91',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee91'
);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
SELECT '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated',
       u.email, crypt('password', gen_salt('bf')), now(), '{}', u.meta, now(), now()
FROM (
  VALUES
    ((SELECT p1 FROM priv_ids), 'p1-priv@test.local', '{"display_name":"Priv One"}'::jsonb),
    ((SELECT p2 FROM priv_ids), 'p2-priv@test.local', '{"display_name":"Priv Two"}'::jsonb),
    ((SELECT outsider FROM priv_ids), 'out-priv@test.local', '{"display_name":"Outsider"}'::jsonb)
) AS u(id, email, meta);

INSERT INTO public.profiles (id, display_name)
SELECT id, raw_user_meta_data ->> 'display_name' FROM auth.users
WHERE id IN (SELECT p1 FROM priv_ids UNION SELECT p2 FROM priv_ids UNION SELECT outsider FROM priv_ids)
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
VALUES (
  (SELECT league_a FROM priv_ids),
  'Priv League',
  'priv-league-chat',
  'America/Chicago',
  (SELECT p1 FROM priv_ids)
);

INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
  ((SELECT league_a FROM priv_ids), (SELECT p1 FROM priv_ids), 'commissioner', true),
  ((SELECT league_a FROM priv_ids), (SELECT p2 FROM priv_ids), 'player', true);

INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
VALUES ((SELECT season_a FROM priv_ids), (SELECT league_a FROM priv_ids), 2097, 'active', 18);

INSERT INTO public.weeks (id, season_id, week_number, label, status, locks_at)
VALUES (
  (SELECT week_a FROM priv_ids), (SELECT season_a FROM priv_ids), 1, 'Week 1', 'open',
  now() + interval '7 days'
);

UPDATE priv_ids SET team_buf = (SELECT id FROM public.teams WHERE abbreviation = 'BUF' LIMIT 1);

SELECT tests.authenticate_as((SELECT p1 FROM priv_ids));
SELECT public.ensure_league_conversation((SELECT league_a FROM priv_ids));
SELECT tests.clear_auth();
UPDATE priv_ids SET conv_a = (
  SELECT id FROM public.conversations
  WHERE league_id = (SELECT league_a FROM priv_ids) AND type = 'league'
  LIMIT 1
);

-- Trusted DB role (NFL sync path) can still invoke reveal.
SELECT lives_ok(
  'SELECT public.reveal_eligible_pick_events()',
  'privileged DB role can invoke reveal_eligible_pick_events'
);

-- Authenticated cannot call internal RPCs.
SELECT tests.authenticate_as((SELECT p1 FROM priv_ids));

SELECT throws_ok(
  format(
    $q$SELECT public.reveal_eligible_pick_events()$q$
  ),
  '42501',
  NULL,
  'authenticated cannot execute reveal_eligible_pick_events'
);

SELECT throws_ok(
  format(
    $q$SELECT public.record_league_event(
      %L::uuid, %L::uuid, %L::uuid, 'week_opened'::public.league_event_type,
      %L::uuid, NULL, 'weeks', %L::uuid, '{}'::jsonb, '{}'::jsonb, true,
      'forge-priv-1', true, NULL, NULL, NULL, NULL, NULL, '{}'::jsonb
    )$q$,
    (SELECT league_a FROM priv_ids),
    (SELECT season_a FROM priv_ids),
    (SELECT week_a FROM priv_ids),
    (SELECT p1 FROM priv_ids),
    (SELECT week_a FROM priv_ids)
  ),
  '42501',
  NULL,
  'authenticated cannot execute record_league_event'
);

SELECT throws_ok(
  format(
    $q$SELECT public.pick_is_revealed_to_peers(%L::uuid)$q$,
    '00000000-0000-0000-0000-000000000001'
  ),
  '42501',
  NULL,
  'authenticated cannot execute pick_is_revealed_to_peers'
);

SELECT throws_ok(
  format(
    $q$SELECT public.profile_display_name(%L::uuid)$q$,
    (SELECT p1 FROM priv_ids)
  ),
  '42501',
  NULL,
  'authenticated cannot execute profile_display_name'
);

SELECT throws_ok(
  'SELECT public.trg_picks_record_league_events()',
  '42501',
  NULL,
  'authenticated cannot execute trg_picks_record_league_events'
);

SELECT throws_ok(
  'SELECT public.trg_games_reveal_pick_events()',
  '42501',
  NULL,
  'authenticated cannot execute trg_games_reveal_pick_events'
);

SELECT throws_ok(
  'SELECT public.trg_weeks_record_league_events()',
  '42501',
  NULL,
  'authenticated cannot execute trg_weeks_record_league_events'
);

SELECT throws_ok(
  'SELECT public.trg_seasons_record_league_events()',
  '42501',
  NULL,
  'authenticated cannot execute trg_seasons_record_league_events'
);

SELECT throws_ok(
  'SELECT public.trg_members_record_league_events()',
  '42501',
  NULL,
  'authenticated cannot execute trg_members_record_league_events'
);

-- League chat access still works for members via RLS + RPC.
SELECT ok(
  (SELECT count(*)::int FROM public.conversations WHERE id = (SELECT conv_a FROM priv_ids)) = 1,
  'league member can read league conversation via RLS'
);

SELECT ok(
  (public.send_conversation_message(
    (SELECT conv_a FROM priv_ids), 'priv league hello', 'priv-league-1'
  )).id IS NOT NULL,
  'authenticated member can send league chat message'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT p1 FROM priv_ids));
UPDATE priv_ids SET dm_a = public.ensure_direct_conversation(
  (SELECT league_a FROM priv_ids), (SELECT p2 FROM priv_ids)
);

SELECT ok(
  (SELECT count(*)::int FROM public.conversations WHERE id = (SELECT dm_a FROM priv_ids)) = 1,
  'DM participant can read own DM conversation'
);

SELECT tests.authenticate_as((SELECT outsider FROM priv_ids));
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE id = (SELECT conv_a FROM priv_ids)),
  0,
  'nonmember cannot read league conversation'
);
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE id = (SELECT dm_a FROM priv_ids)),
  0,
  'nonparticipant cannot read DM conversation'
);

-- Anonymous cannot execute member-facing RPCs.
SELECT tests.set_anon();
SELECT throws_ok(
  format(
    $q$SELECT public.send_conversation_message(%L::uuid, 'anon', NULL)$q$,
    (SELECT conv_a FROM priv_ids)
  ),
  '42501',
  NULL,
  'anon cannot execute send_conversation_message'
);
SELECT throws_ok(
  format(
    $q$SELECT public.ensure_league_conversation(%L::uuid)$q$,
    (SELECT league_a FROM priv_ids)
  ),
  '42501',
  NULL,
  'anon cannot execute ensure_league_conversation'
);
SELECT throws_ok(
  format(
    $q$SELECT public.mark_all_notifications_read(%L::uuid)$q$,
    (SELECT league_a FROM priv_ids)
  ),
  '42501',
  NULL,
  'anon cannot execute mark_all_notifications_read'
);

SELECT tests.clear_auth();
SELECT * FROM finish();
ROLLBACK;
