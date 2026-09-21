-- Idempotency isolation, revealed payloads, and kickoff reveal function tests.
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

SELECT plan(21);
SELECT tests.clear_auth();

CREATE TEMP TABLE idfix_ids (
  p1 UUID, p2 UUID, p3 UUID, commish UUID,
  league_a UUID, season_a UUID, week_future UUID, week_past UUID,
  team_buf UUID, team_kc UUID,
  league_conv UUID, dm12 UUID, dm13 UUID,
  msg1 UUID, msg2 UUID, event_id UUID, game_past UUID
);

GRANT SELECT ON idfix_ids TO authenticated;

INSERT INTO idfix_ids (p1, p2, p3, commish, league_a, season_a, week_future, week_past)
VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab02',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab03',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab04',
  'cccccccc-cccc-cccc-cccc-cccccccccb01',
  'dddddddd-dddd-dddd-dddd-dddddddddb01',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeb01',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeb02'
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
    ((SELECT p1 FROM idfix_ids), 'p1-idfix@test.local', '{"display_name":"Idem One"}'::jsonb),
    ((SELECT p2 FROM idfix_ids), 'p2-idfix@test.local', '{"display_name":"Idem Two"}'::jsonb),
    ((SELECT p3 FROM idfix_ids), 'p3-idfix@test.local', '{"display_name":"Idem Three"}'::jsonb),
    ((SELECT commish FROM idfix_ids), 'commish-idfix@test.local', '{"display_name":"Idem Commish"}'::jsonb)
) AS u(id, email, meta);

INSERT INTO public.profiles (id, display_name)
VALUES
  ((SELECT p1 FROM idfix_ids), 'Idem One'),
  ((SELECT p2 FROM idfix_ids), 'Idem Two'),
  ((SELECT p3 FROM idfix_ids), 'Idem Three'),
  ((SELECT commish FROM idfix_ids), 'Idem Commish')
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
VALUES (
  (SELECT league_a FROM idfix_ids), 'Idem League', 'idem-league', 'America/Chicago',
  (SELECT commish FROM idfix_ids)
);

INSERT INTO public.league_members (league_id, user_id, role, active)
VALUES
  ((SELECT league_a FROM idfix_ids), (SELECT commish FROM idfix_ids), 'commissioner', true),
  ((SELECT league_a FROM idfix_ids), (SELECT p1 FROM idfix_ids), 'player', true),
  ((SELECT league_a FROM idfix_ids), (SELECT p2 FROM idfix_ids), 'player', true),
  ((SELECT league_a FROM idfix_ids), (SELECT p3 FROM idfix_ids), 'player', true);

INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
VALUES ((SELECT season_a FROM idfix_ids), (SELECT league_a FROM idfix_ids), 2098, 'active', 18);

INSERT INTO public.weeks (id, season_id, week_number, label, status, locks_at)
VALUES
  ((SELECT week_future FROM idfix_ids), (SELECT season_a FROM idfix_ids), 5, 'Week 5', 'open', now() + interval '3 days'),
  ((SELECT week_past FROM idfix_ids), (SELECT season_a FROM idfix_ids), 4, 'Week 4', 'locked', now() - interval '1 day');

UPDATE idfix_ids SET
  team_buf = (SELECT id FROM public.teams WHERE abbreviation = 'BUF' LIMIT 1),
  team_kc = (SELECT id FROM public.teams WHERE abbreviation = 'KC' LIMIT 1);

-- Conversations
SELECT tests.authenticate_as((SELECT p1 FROM idfix_ids));
SELECT ok(public.ensure_league_conversation((SELECT league_a FROM idfix_ids)) IS NOT NULL, 'league conv exists');
SELECT ok(
  public.ensure_direct_conversation((SELECT league_a FROM idfix_ids), (SELECT p2 FROM idfix_ids)) IS NOT NULL,
  'dm12 exists'
);
SELECT ok(
  public.ensure_direct_conversation((SELECT league_a FROM idfix_ids), (SELECT p3 FROM idfix_ids)) IS NOT NULL,
  'dm13 exists'
);
SELECT tests.clear_auth();
UPDATE idfix_ids SET
  league_conv = (SELECT id FROM public.conversations WHERE league_id = (SELECT league_a FROM idfix_ids) AND type = 'league'),
  dm12 = (
    SELECT id FROM public.conversations
    WHERE league_id = (SELECT league_a FROM idfix_ids) AND type = 'direct'
      AND dm_user_low = least((SELECT p1 FROM idfix_ids), (SELECT p2 FROM idfix_ids))
      AND dm_user_high = greatest((SELECT p1 FROM idfix_ids), (SELECT p2 FROM idfix_ids))
  ),
  dm13 = (
    SELECT id FROM public.conversations
    WHERE league_id = (SELECT league_a FROM idfix_ids) AND type = 'direct'
      AND dm_user_low = least((SELECT p1 FROM idfix_ids), (SELECT p3 FROM idfix_ids))
      AND dm_user_high = greatest((SELECT p1 FROM idfix_ids), (SELECT p3 FROM idfix_ids))
  );

-- Same sender / same conversation retry returns original
SELECT tests.authenticate_as((SELECT p1 FROM idfix_ids));
SELECT ok(
  (public.send_conversation_message((SELECT dm12 FROM idfix_ids), 'hello', 'shared-key')).id IS NOT NULL,
  'p1 can send with client idempotency key'
);
SELECT tests.clear_auth();
UPDATE idfix_ids SET msg1 = (
  SELECT id FROM public.messages
  WHERE conversation_id = (SELECT dm12 FROM idfix_ids)
    AND author_user_id = (SELECT p1 FROM idfix_ids)
    AND client_idempotency_key = 'shared-key'
  LIMIT 1
);
SELECT tests.authenticate_as((SELECT p1 FROM idfix_ids));
SELECT ok(
  (public.send_conversation_message((SELECT dm12 FROM idfix_ids), 'hello again', 'shared-key')).id
    = (SELECT msg1 FROM idfix_ids),
  'same sender/same conversation retry returns original message'
);
SELECT ok(
  (SELECT body FROM public.messages WHERE id = (SELECT msg1 FROM idfix_ids)) = 'hello',
  'retry does not overwrite original body'
);

-- Same key in different conversations does not leak
SELECT ok(
  (public.send_conversation_message((SELECT dm13 FROM idfix_ids), 'other thread', 'shared-key')).id
    IS DISTINCT FROM (SELECT msg1 FROM idfix_ids),
  'same key in different conversations creates a distinct message'
);
SELECT ok(
  (SELECT body FROM public.messages WHERE id = (SELECT msg1 FROM idfix_ids)) = 'hello',
  'cross-conversation key does not return or alter the other message'
);

-- Different users same key do not see each other
SELECT tests.authenticate_as((SELECT p2 FROM idfix_ids));
SELECT ok(
  (public.send_conversation_message((SELECT dm12 FROM idfix_ids), 'from p2', 'shared-key')).id IS NOT NULL,
  'p2 can send with same client key in same conversation'
);
SELECT tests.clear_auth();
UPDATE idfix_ids SET msg2 = (
  SELECT id FROM public.messages
  WHERE conversation_id = (SELECT dm12 FROM idfix_ids)
    AND author_user_id = (SELECT p2 FROM idfix_ids)
    AND client_idempotency_key = 'shared-key'
  LIMIT 1
);
SELECT ok(
  (SELECT msg2 FROM idfix_ids) IS DISTINCT FROM (SELECT msg1 FROM idfix_ids),
  'different users using the same key get distinct messages'
);
SELECT tests.authenticate_as((SELECT p2 FROM idfix_ids));
SELECT ok(
  (public.send_conversation_message((SELECT dm12 FROM idfix_ids), 'from p2 again', 'shared-key')).id
    = (SELECT msg2 FROM idfix_ids),
  'p2 retry path returns p2 own message only'
);

-- User cannot collide with / occupy system namespace
SELECT tests.authenticate_as((SELECT p1 FROM idfix_ids));
SELECT throws_ok(
  format(
    'SELECT public.send_conversation_message(%L::uuid, %L, %L)',
    (SELECT dm12 FROM idfix_ids), 'nope', 'system_msg:evil'
  ),
  '22023', NULL, 'user cannot create keys in system-message namespace'
);

-- User cannot suppress a future system message via client key
SELECT tests.clear_auth();
INSERT INTO public.messages (
  conversation_id, league_id, kind, body, system_idempotency_key
) VALUES (
  (SELECT league_conv FROM idfix_ids), (SELECT league_a FROM idfix_ids),
  'system', NULL, 'system_msg:future-event-1'
);
SELECT tests.authenticate_as((SELECT p1 FROM idfix_ids));
SELECT lives_ok(
  format(
    'SELECT public.send_conversation_message(%L::uuid, %L, %L)',
    (SELECT league_conv FROM idfix_ids), 'user chatter', 'future-event-1'
  ),
  'user client key that matches system suffix still allowed as client namespace'
);
SELECT ok(
  (SELECT count(*)::int FROM public.messages
   WHERE system_idempotency_key = 'system_msg:future-event-1') = 1,
  'user cannot suppress an existing system message'
);

-- Commissioner cannot inspect DM via idempotency
SELECT tests.authenticate_as((SELECT commish FROM idfix_ids));
SELECT throws_ok(
  format(
    'SELECT public.send_conversation_message(%L::uuid, %L, %L)',
    (SELECT dm12 FROM idfix_ids), 'peek', 'shared-key'
  ),
  '42501', NULL, 'commissioner cannot use idempotency against unrelated DM'
);
SELECT is(
  (SELECT count(*)::int FROM public.messages WHERE id = (SELECT msg1 FROM idfix_ids)),
  0,
  'commissioner cannot select DM message rows'
);

-- Revealed vs unrevealed payloads on event creation
SELECT tests.clear_auth();
INSERT INTO public.games (
  provider, provider_game_id, season_year, season_type, regular_week_number,
  home_team_id, away_team_id, scheduled_kickoff_at, status,
  home_score, away_score, winner_team_id
) VALUES (
  'nflverse', 'idem-past-game', 2098, 'regular', 4,
  (SELECT team_kc FROM idfix_ids), (SELECT team_buf FROM idfix_ids),
  now() - interval '2 hours', 'final',
  24, 17, (SELECT team_kc FROM idfix_ids)
);

UPDATE idfix_ids SET game_past = (SELECT id FROM public.games WHERE provider_game_id = 'idem-past-game');

-- Unrevealed pick (future kickoff)
INSERT INTO public.games (
  provider, provider_game_id, season_year, season_type, regular_week_number,
  home_team_id, away_team_id, scheduled_kickoff_at, status
) VALUES (
  'nflverse', 'idem-future-game', 2098, 'regular', 5,
  (SELECT team_kc FROM idfix_ids), (SELECT team_buf FROM idfix_ids),
  now() + interval '2 days', 'scheduled'
);

INSERT INTO public.picks (week_id, user_id, team_id, result, game_id)
SELECT (SELECT week_future FROM idfix_ids), (SELECT p1 FROM idfix_ids),
       (SELECT team_buf FROM idfix_ids), 'pending',
       (SELECT id FROM public.games WHERE provider_game_id = 'idem-future-game');

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.league_events e
    WHERE e.affected_user_id = (SELECT p1 FROM idfix_ids)
      AND e.event_type = 'pick_submitted'
      AND e.is_revealed = false
      AND NOT (e.payload ? 'team_id')
      AND (e.sensitive_payload ->> 'team_id') = (SELECT team_buf FROM idfix_ids)::text
  ),
  'pick submitted before reveal hides team ids in public payload'
);

-- After-reveal pick creation
INSERT INTO public.picks (week_id, user_id, team_id, result, game_id)
SELECT (SELECT week_past FROM idfix_ids), (SELECT p2 FROM idfix_ids),
       (SELECT team_kc FROM idfix_ids), 'pending',
       (SELECT game_past FROM idfix_ids);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.league_events e
    WHERE e.affected_user_id = (SELECT p2 FROM idfix_ids)
      AND e.event_type = 'pick_submitted'
      AND e.is_revealed = true
      AND (e.payload ->> 'team_id') = (SELECT team_kc FROM idfix_ids)::text
  ),
  'pick event created after reveal includes team id in public payload'
);

-- Kickoff reveal function promotes an eligible unrevealed event.
-- Disable the game trigger so time advance alone does not reveal before we call the function.
ALTER TABLE public.games DISABLE TRIGGER games_reveal_pick_events;
UPDATE public.games
SET scheduled_kickoff_at = now() - interval '5 minutes'
WHERE provider_game_id = 'idem-future-game';
ALTER TABLE public.games ENABLE TRIGGER games_reveal_pick_events;

SELECT ok(
  public.reveal_eligible_pick_events() >= 1,
  'reveal_eligible_pick_events promotes eligible events'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.league_events e
    WHERE e.affected_user_id = (SELECT p1 FROM idfix_ids)
      AND e.event_type = 'pick_submitted'
      AND e.is_revealed = true
      AND (e.payload ->> 'team_id') = (SELECT team_buf FROM idfix_ids)::text
  ),
  'eligible unrevealed event becomes public through reveal function'
);

SELECT is(
  public.reveal_eligible_pick_events(),
  0,
  'repeated reveal execution is harmless'
);

SELECT tests.clear_auth();
SELECT * FROM finish();
ROLLBACK;
