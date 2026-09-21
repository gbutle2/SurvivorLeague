-- League chat / DM / notification authorization tests (pgTAP).
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

GRANT USAGE ON SCHEMA tests TO authenticated;
GRANT EXECUTE ON FUNCTION tests.authenticate_as(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION tests.clear_auth() TO authenticated;

SELECT plan(24);
SELECT tests.clear_auth();

CREATE TEMP TABLE chat_ids (
  p1 UUID, p2 UUID, p3 UUID, commish UUID, outsider UUID,
  league_a UUID, league_b UUID, season_a UUID, week_a UUID,
  team_buf UUID, team_kc UUID,
  conv_a UUID, dm_a UUID, msg_id UUID
);

GRANT SELECT ON chat_ids TO authenticated;

INSERT INTO chat_ids (
  p1, p2, p3, commish, outsider, league_a, league_b, season_a, week_a
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa03',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa04',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbb01',
  'cccccccc-cccc-cccc-cccc-cccccccccc01',
  'cccccccc-cccc-cccc-cccc-cccccccccc02',
  'dddddddd-dddd-dddd-dddd-dddddddddd01',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
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
    ((SELECT p1 FROM chat_ids), 'p1-chat@test.local', '{"display_name":"Pat One"}'::jsonb),
    ((SELECT p2 FROM chat_ids), 'p2-chat@test.local', '{"display_name":"Pat Two"}'::jsonb),
    ((SELECT p3 FROM chat_ids), 'p3-chat@test.local', '{"display_name":"Pat Three"}'::jsonb),
    ((SELECT commish FROM chat_ids), 'commish-chat@test.local', '{"display_name":"Commish"}'::jsonb),
    ((SELECT outsider FROM chat_ids), 'out-chat@test.local', '{"display_name":"Outsider"}'::jsonb)
) AS u(id, email, meta);

INSERT INTO public.profiles (id, display_name)
VALUES
  ((SELECT p1 FROM chat_ids), 'Pat One'),
  ((SELECT p2 FROM chat_ids), 'Pat Two'),
  ((SELECT p3 FROM chat_ids), 'Pat Three'),
  ((SELECT commish FROM chat_ids), 'Commish'),
  ((SELECT outsider FROM chat_ids), 'Outsider')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
VALUES
  ((SELECT league_a FROM chat_ids), 'League A Chat', 'league-a-chat', 'America/Chicago', (SELECT commish FROM chat_ids)),
  ((SELECT league_b FROM chat_ids), 'League B Chat', 'league-b-chat', 'America/Chicago', (SELECT outsider FROM chat_ids));

INSERT INTO public.league_members (league_id, user_id, role, active)
VALUES
  ((SELECT league_a FROM chat_ids), (SELECT commish FROM chat_ids), 'commissioner', true),
  ((SELECT league_a FROM chat_ids), (SELECT p1 FROM chat_ids), 'player', true),
  ((SELECT league_a FROM chat_ids), (SELECT p2 FROM chat_ids), 'player', true),
  ((SELECT league_a FROM chat_ids), (SELECT p3 FROM chat_ids), 'player', true),
  ((SELECT league_b FROM chat_ids), (SELECT outsider FROM chat_ids), 'commissioner', true);

INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
VALUES ((SELECT season_a FROM chat_ids), (SELECT league_a FROM chat_ids), 2099, 'active', 18);

INSERT INTO public.weeks (id, season_id, week_number, label, status, locks_at)
VALUES ((SELECT week_a FROM chat_ids), (SELECT season_a FROM chat_ids), 4, 'Week 4', 'open', now() + interval '2 days');

SELECT tests.clear_auth();
UPDATE chat_ids SET
  team_buf = (SELECT id FROM public.teams WHERE abbreviation = 'BUF' LIMIT 1),
  team_kc = (SELECT id FROM public.teams WHERE abbreviation = 'KC' LIMIT 1);

SELECT tests.authenticate_as((SELECT p1 FROM chat_ids));
SELECT ok(
  public.ensure_league_conversation((SELECT league_a FROM chat_ids)) IS NOT NULL,
  'member can ensure league conversation'
);
SELECT tests.clear_auth();
UPDATE chat_ids SET conv_a = (
  SELECT id FROM public.conversations
  WHERE league_id = (SELECT league_a FROM chat_ids) AND type = 'league'
  LIMIT 1
);

SELECT ok(
  (SELECT count(*) FROM public.conversations c
   WHERE c.league_id = (SELECT league_a FROM chat_ids) AND c.type = 'league') = 1,
  'exactly one league conversation per league'
);

SELECT tests.authenticate_as((SELECT p1 FROM chat_ids));
SELECT ok(
  public.ensure_league_conversation((SELECT league_a FROM chat_ids)) = (SELECT conv_a FROM chat_ids),
  'ensure_league_conversation is idempotent'
);

SELECT tests.authenticate_as((SELECT outsider FROM chat_ids));
SELECT throws_ok(
  format('SELECT public.ensure_league_conversation(%L::uuid)', (SELECT league_a FROM chat_ids)),
  '42501', NULL, 'outsider cannot ensure league conversation'
);
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE league_id = (SELECT league_a FROM chat_ids)),
  0,
  'outsider cannot select league A conversations'
);

SELECT tests.authenticate_as((SELECT p1 FROM chat_ids));
SELECT ok(
  public.ensure_direct_conversation((SELECT league_a FROM chat_ids), (SELECT p2 FROM chat_ids)) IS NOT NULL,
  'member can ensure DM conversation'
);
SELECT tests.clear_auth();
UPDATE chat_ids SET dm_a = (
  SELECT id FROM public.conversations
  WHERE league_id = (SELECT league_a FROM chat_ids) AND type = 'direct'
  LIMIT 1
);
SELECT tests.authenticate_as((SELECT p1 FROM chat_ids));
SELECT ok(
  public.ensure_direct_conversation((SELECT league_a FROM chat_ids), (SELECT p2 FROM chat_ids))
    = (SELECT dm_a FROM chat_ids),
  'DM ensure is idempotent for same pair'
);

SELECT tests.authenticate_as((SELECT p2 FROM chat_ids));
SELECT ok(
  public.ensure_direct_conversation((SELECT league_a FROM chat_ids), (SELECT p1 FROM chat_ids))
    = (SELECT dm_a FROM chat_ids),
  'DM pair is unordered'
);

SELECT tests.authenticate_as((SELECT p3 FROM chat_ids));
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE id = (SELECT dm_a FROM chat_ids)),
  0,
  'nonparticipant cannot read DM conversation'
);

SELECT tests.authenticate_as((SELECT commish FROM chat_ids));
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE id = (SELECT dm_a FROM chat_ids)),
  0,
  'commissioner cannot read unrelated DM'
);

SELECT tests.authenticate_as((SELECT p1 FROM chat_ids));
SELECT ok(
  (public.send_conversation_message((SELECT dm_a FROM chat_ids), 'Hello P2', 'idem-dm-1')).id IS NOT NULL,
  'participant can send DM'
);
SELECT tests.clear_auth();
UPDATE chat_ids SET msg_id = (
  SELECT id FROM public.messages WHERE idempotency_key = 'idem-dm-1' LIMIT 1
);
SELECT tests.authenticate_as((SELECT p1 FROM chat_ids));
SELECT ok((SELECT msg_id FROM chat_ids) IS NOT NULL, 'DM message persisted');

SELECT tests.authenticate_as((SELECT p3 FROM chat_ids));
SELECT throws_ok(
  format(
    'SELECT public.send_conversation_message(%L::uuid, %L, NULL)',
    (SELECT dm_a FROM chat_ids), 'hack'
  ),
  '42501', NULL, 'p3 cannot send to p1-p2 DM'
);

SELECT tests.authenticate_as((SELECT p1 FROM chat_ids));
SELECT throws_ok(
  format(
    $q$INSERT INTO public.messages (
      conversation_id, league_id, kind, author_user_id, body
    ) VALUES (%L::uuid, %L::uuid, 'system', NULL, 'fake')$q$,
    (SELECT conv_a FROM chat_ids), (SELECT league_a FROM chat_ids)
  ),
  NULL, NULL, 'clients cannot insert system messages'
);

SELECT throws_ok(
  format(
    $q$INSERT INTO public.league_events (
      league_id, event_type, payload, sensitive_payload, idempotency_key
    ) VALUES (%L::uuid, 'week_opened', '{}', '{"team_id":"x"}', 'forge-1')$q$,
    (SELECT league_a FROM chat_ids)
  ),
  NULL, NULL, 'clients cannot forge league events'
);

SELECT tests.clear_auth();
INSERT INTO public.games (
  provider, provider_game_id, season_year, season_type, regular_week_number,
  home_team_id, away_team_id, scheduled_kickoff_at, status
)
VALUES (
  'nflverse', 'test-chat-w4-buf', 2099, 'regular', 4,
  (SELECT team_kc FROM chat_ids), (SELECT team_buf FROM chat_ids),
  now() + interval '1 day', 'scheduled'
);

INSERT INTO public.picks (week_id, user_id, team_id, result)
VALUES ((SELECT week_a FROM chat_ids), (SELECT p1 FROM chat_ids), (SELECT team_buf FROM chat_ids), 'pending');

SELECT ok(
  (
    SELECT count(*) FROM public.league_events
    WHERE domain_table = 'picks'
      AND affected_user_id = (SELECT p1 FROM chat_ids)
      AND event_type = 'pick_submitted'
  ) = 1,
  'first pick creates exactly one pick_submitted event'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.league_events e
    WHERE e.event_type = 'pick_submitted'
      AND e.is_revealed = false
      AND (e.payload ? 'team_id' OR e.payload ? 'previous_team_id')
  ),
  'unrevealed pick events do not put team ids in public payload'
);

UPDATE public.league_members
SET active = false
WHERE league_id = (SELECT league_a FROM chat_ids)
  AND user_id = (SELECT p3 FROM chat_ids);

SELECT tests.authenticate_as((SELECT p3 FROM chat_ids));
SELECT is(
  (SELECT count(*)::int FROM public.conversations WHERE league_id = (SELECT league_a FROM chat_ids)),
  0,
  'removed member cannot read league conversations'
);
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE league_id = (SELECT league_a FROM chat_ids)),
  0,
  'removed member cannot read league notifications'
);

SELECT tests.clear_auth();
INSERT INTO public.notifications (
  recipient_user_id, league_id, notification_type, title, body, idempotency_key
) VALUES (
  (SELECT p1 FROM chat_ids), (SELECT league_a FROM chat_ids),
  'week_opened', 'Week open', 'Week 4 opened', 'notif-test-p1'
);

SELECT tests.authenticate_as((SELECT p2 FROM chat_ids));
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE idempotency_key = 'notif-test-p1'),
  0,
  'users cannot read another recipient notification'
);

SELECT tests.authenticate_as((SELECT p1 FROM chat_ids));
SELECT is(
  (SELECT count(*)::int FROM public.notifications WHERE idempotency_key = 'notif-test-p1'),
  1,
  'recipient can read own notification'
);

SELECT ok(
  (public.soft_delete_own_message((SELECT msg_id FROM chat_ids))).deleted_at IS NOT NULL,
  'author can soft-delete own message'
);
SELECT ok(
  (SELECT body FROM public.messages WHERE id = (SELECT msg_id FROM chat_ids)) IS NULL,
  'soft-deleted message body is cleared'
);

SELECT throws_ok(
  format(
    'SELECT public.ensure_direct_conversation(%L::uuid, %L::uuid)',
    (SELECT league_a FROM chat_ids), (SELECT outsider FROM chat_ids)
  ),
  '42501', NULL, 'cannot DM a non-member of the league'
);

SELECT tests.clear_auth();
SELECT * FROM finish();
ROLLBACK;
