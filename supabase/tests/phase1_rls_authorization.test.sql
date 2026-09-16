-- Repeatable Phase 1 authorization tests (pgTAP).
-- Run: npm run test:db
-- Requires local Supabase (Docker). Rolls back all fixture data.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

CREATE SCHEMA IF NOT EXISTS tests;

-- INVOKER helpers: switch JWT claims / role as the calling test role.
-- Do not use SECURITY DEFINER here; application helpers remain separate.
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
    json_build_object(
      'sub', p_user_id::text,
      'role', 'authenticated'
    )::text,
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

SELECT plan(26);

SELECT tests.clear_auth();

DO $$
DECLARE
  v_player1 UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1';
  v_player2 UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2';
  v_inactive UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3';
  v_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4';
  v_other UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1';
  v_league_a UUID := 'cccccccc-cccc-cccc-cccc-ccccccccccc1';
  v_league_b UUID := 'cccccccc-cccc-cccc-cccc-ccccccccccc2';
  v_season_a UUID := 'dddddddd-dddd-dddd-dddd-ddddddddddd1';
  v_season_b UUID := 'dddddddd-dddd-dddd-dddd-ddddddddddd2';
  v_week_open UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1';
  v_week_locked UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2';
  v_week_exact UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee3';
  v_week2 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee4';
  v_week_b UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee5';
  v_round1 UUID := 'ffffffff-ffff-ffff-ffff-fffffffffff1';
  v_round2 UUID := 'ffffffff-ffff-ffff-ffff-fffffffffff2';
  v_team_kc UUID;
  v_team_buf UUID;
  v_team_det UUID;
  v_team_phi UUID;
  v_team_sf UUID;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  VALUES
    ('00000000-0000-0000-0000-000000000000', v_player1, 'authenticated', 'authenticated',
     'player1@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Player One"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_player2, 'authenticated', 'authenticated',
     'player2@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Player Two"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_inactive, 'authenticated', 'authenticated',
     'inactive@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Inactive"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_commish, 'authenticated', 'authenticated',
     'commish@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Commissioner"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_other, 'authenticated', 'authenticated',
     'otherleague@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Other League"}', now(), now());

  -- League A commissioner is v_commish; League B commissioner is v_player1
  -- (player in A, commissioner in B) for cross-league move tests.
  INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
  VALUES
    (v_league_a, 'League A', 'league-a', 'America/Chicago', v_commish),
    (v_league_b, 'League B', 'league-b', 'America/Chicago', v_player1);

  INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
    (v_league_a, v_commish, 'commissioner', true),
    (v_league_a, v_player1, 'player', true),
    (v_league_a, v_player2, 'player', true),
    (v_league_a, v_inactive, 'player', false),
    (v_league_b, v_player1, 'commissioner', true),
    (v_league_b, v_other, 'player', true);

  INSERT INTO public.seasons (id, league_id, year, status)
  VALUES
    (v_season_a, v_league_a, 2026, 'active'),
    (v_season_b, v_league_b, 2026, 'active');

  INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status) VALUES
    (v_week_open, v_season_a, 1, 'Week 1', now() + interval '2 days', 'open'),
    (v_week_locked, v_season_a, 2, 'Week 2 locked', now() - interval '1 hour', 'locked'),
    (v_week_exact, v_season_a, 3, 'Week 3 exact', now(), 'open'),
    (v_week2, v_season_a, 4, 'Week 4', now() + interval '3 days', 'open'),
    (v_week_b, v_season_b, 1, 'League B Week 1', now() + interval '2 days', 'open');

  INSERT INTO public.playoff_rounds (id, season_id, round_number, name, points, locks_at, status) VALUES
    (v_round1, v_season_a, 1, 'Wild Card', 2, now() + interval '2 days', 'open'),
    (v_round2, v_season_a, 2, 'Divisional', 4, now() + interval '5 days', 'open');

  SELECT id INTO v_team_kc FROM public.teams WHERE abbreviation = 'KC';
  SELECT id INTO v_team_buf FROM public.teams WHERE abbreviation = 'BUF';
  SELECT id INTO v_team_det FROM public.teams WHERE abbreviation = 'DET';
  SELECT id INTO v_team_phi FROM public.teams WHERE abbreviation = 'PHI';
  SELECT id INTO v_team_sf FROM public.teams WHERE abbreviation = 'SF';

  INSERT INTO public.picks (id, week_id, user_id, team_id, result)
  VALUES ('99999999-9999-9999-9999-999999999901', v_week_locked, v_player1, v_team_phi, 'pending');

  CREATE TEMP TABLE test_ids AS
  SELECT
    v_player1 AS player1,
    v_player2 AS player2,
    v_inactive AS inactive,
    v_commish AS commish,
    v_other AS other_user,
    v_league_a AS league_a,
    v_league_b AS league_b,
    v_week_open AS week_open,
    v_week_locked AS week_locked,
    v_week_exact AS week_exact,
    v_week2 AS week2,
    v_week_b AS week_b,
    v_round1 AS round1,
    v_round2 AS round2,
    v_team_kc AS team_kc,
    v_team_buf AS team_buf,
    v_team_det AS team_det,
    v_team_phi AS team_phi,
    v_team_sf AS team_sf,
    '99999999-9999-9999-9999-999999999901'::uuid AS locked_pick_id;
END;
$$;

-- 1) Active player inserts own pick before lock
SELECT tests.authenticate_as((SELECT player1 FROM test_ids));
SELECT lives_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT week_open FROM test_ids),
    (SELECT player1 FROM test_ids),
    (SELECT team_kc FROM test_ids)
  ),
  'active player inserts own pick before lock'
);

-- 2) Another player cannot read it before lock
SELECT tests.authenticate_as((SELECT player2 FROM test_ids));
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.picks
    WHERE week_id = (SELECT week_open FROM test_ids)
      AND user_id = (SELECT player1 FROM test_ids)
  ),
  0,
  'another player cannot read pick before lock'
);

-- 3) League members can read after lock
SELECT tests.authenticate_as((SELECT player2 FROM test_ids));
SELECT cmp_ok(
  (
    SELECT count(*)::integer
    FROM public.picks
    WHERE week_id = (SELECT week_locked FROM test_ids)
      AND user_id = (SELECT player1 FROM test_ids)
  ),
  '>',
  0,
  'league members can read picks after lock'
);

-- 4) Inactive member cannot insert
SELECT tests.authenticate_as((SELECT inactive FROM test_ids));
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT week_open FROM test_ids),
    (SELECT inactive FROM test_ids),
    (SELECT team_buf FROM test_ids)
  ),
  'inactive member cannot insert pick'
);

-- 5) Inactive member cannot update
SELECT tests.clear_auth();
INSERT INTO public.picks (id, week_id, user_id, team_id)
VALUES (
  '99999999-9999-9999-9999-999999999902',
  (SELECT week_open FROM test_ids),
  (SELECT inactive FROM test_ids),
  (SELECT team_det FROM test_ids)
);
SELECT tests.authenticate_as((SELECT inactive FROM test_ids));
SELECT is(
  (
    WITH u AS (
      UPDATE public.picks
      SET team_id = (SELECT team_buf FROM test_ids)
      WHERE id = '99999999-9999-9999-9999-999999999902'
      RETURNING 1
    )
    SELECT count(*)::integer FROM u
  ),
  0,
  'inactive member cannot update pick'
);

-- 6) Player cannot modify protected result field
SELECT tests.authenticate_as((SELECT player1 FROM test_ids));
SELECT throws_ok(
  format(
    'UPDATE public.picks SET result = %L WHERE week_id = %L AND user_id = %L',
    'win',
    (SELECT week_open FROM test_ids),
    (SELECT player1 FROM test_ids)
  ),
  'player cannot modify protected fields'
);

-- 7) Player cannot reuse a regular-season team
SELECT tests.authenticate_as((SELECT player1 FROM test_ids));
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT week2 FROM test_ids),
    (SELECT player1 FROM test_ids),
    (SELECT team_kc FROM test_ids)
  ),
  'player cannot reuse a regular-season team'
);

-- 8) Regular/playoff lists separate
SELECT tests.authenticate_as((SELECT player1 FROM test_ids));
SELECT lives_ok(
  format(
    'INSERT INTO public.playoff_picks (playoff_round_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT round1 FROM test_ids),
    (SELECT player1 FROM test_ids),
    (SELECT team_kc FROM test_ids)
  ),
  'regular and playoff reuse lists are separate'
);

-- 9) Player cannot reuse a playoff team
SELECT tests.authenticate_as((SELECT player1 FROM test_ids));
SELECT throws_ok(
  format(
    'INSERT INTO public.playoff_picks (playoff_round_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT round2 FROM test_ids),
    (SELECT player1 FROM test_ids),
    (SELECT team_kc FROM test_ids)
  ),
  'player cannot reuse a playoff team'
);

-- 10) Player cannot set playoff points
SELECT tests.authenticate_as((SELECT player1 FROM test_ids));
SELECT throws_ok(
  format(
    'UPDATE public.playoff_picks SET points_awarded = 2 WHERE playoff_round_id = %L AND user_id = %L',
    (SELECT round1 FROM test_ids),
    (SELECT player1 FROM test_ids)
  ),
  'player cannot set results or points'
);

-- 11) Commissioner can set results
SELECT tests.authenticate_as((SELECT commish FROM test_ids));
SELECT lives_ok(
  format(
    'UPDATE public.picks SET result = %L WHERE id = %L',
    'win',
    (SELECT locked_pick_id FROM test_ids)
  ),
  'commissioner can set results'
);

-- 12) Cross-league users cannot read
SELECT tests.authenticate_as((SELECT other_user FROM test_ids));
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.picks
    WHERE week_id = (SELECT week_locked FROM test_ids)
  ),
  0,
  'cross-league users cannot read data'
);

-- 13) Cross-league users cannot modify
SELECT tests.authenticate_as((SELECT other_user FROM test_ids));
SELECT is(
  (
    WITH u AS (
      UPDATE public.picks
      SET result = 'loss'
      WHERE id = (SELECT locked_pick_id FROM test_ids)
      RETURNING 1
    )
    SELECT count(*)::integer FROM u
  ),
  0,
  'cross-league users cannot modify data'
);

-- 14) Exact lock timestamp is treated as locked
SELECT tests.clear_auth();
SELECT ok(
  public.week_is_locked((SELECT week_exact FROM test_ids))
  AND NOT public.week_is_unlocked((SELECT week_exact FROM test_ids)),
  'exact lock timestamp is treated as locked'
);

-- 15) Self-promotion to commissioner fails
SELECT tests.authenticate_as((SELECT player2 FROM test_ids));
SELECT is(
  (
    WITH u AS (
      UPDATE public.league_members
      SET role = 'commissioner'
      WHERE league_id = (SELECT league_a FROM test_ids)
        AND user_id = (SELECT player2 FROM test_ids)
      RETURNING 1
    )
    SELECT count(*)::integer FROM u
  ),
  0,
  'self-promotion to commissioner fails'
);

-- 16) Player can change team_id before deadline
SELECT tests.authenticate_as((SELECT player1 FROM test_ids));
SELECT lives_ok(
  format(
    'UPDATE public.picks SET team_id = %L WHERE week_id = %L AND user_id = %L',
    (SELECT team_sf FROM test_ids),
    (SELECT week_open FROM test_ids),
    (SELECT player1 FROM test_ids)
  ),
  'player can change only team_id before deadline'
);

-- 17) Teams table read-only for authenticated users
SELECT tests.authenticate_as((SELECT commish FROM test_ids));
SELECT throws_ok(
  'UPDATE public.teams SET city = ''Hacked'' WHERE abbreviation = ''KC''',
  'teams table is read-only for authenticated users'
);

-- 18) Insert at exact lock timestamp rejected
SELECT tests.authenticate_as((SELECT player2 FROM test_ids));
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT week_exact FROM test_ids),
    (SELECT player2 FROM test_ids),
    (SELECT team_buf FROM test_ids)
  ),
  'insert at exact lock timestamp is rejected'
);

-- 19) League A player / League B commissioner cannot move League A pick to B
SELECT tests.authenticate_as((SELECT player1 FROM test_ids));
SELECT throws_ok(
  format(
    'UPDATE public.picks SET week_id = %L WHERE week_id = %L AND user_id = %L',
    (SELECT week_b FROM test_ids),
    (SELECT week_open FROM test_ids),
    (SELECT player1 FROM test_ids)
  ),
  'player-commish dual role cannot move League A pick to League B'
);

-- 20) id is immutable (including for commissioner)
SELECT tests.authenticate_as((SELECT commish FROM test_ids));
SELECT throws_ok(
  format(
    'UPDATE public.picks SET id = %L WHERE id = %L',
    '99999999-9999-9999-9999-999999999999',
    (SELECT locked_pick_id FROM test_ids)
  ),
  'id is immutable'
);

-- 21) user_id is immutable (commissioner cannot reassign)
SELECT tests.authenticate_as((SELECT commish FROM test_ids));
SELECT throws_ok(
  format(
    'UPDATE public.picks SET user_id = %L WHERE id = %L',
    (SELECT player2 FROM test_ids),
    (SELECT locked_pick_id FROM test_ids)
  ),
  'user_id is immutable; commissioner cannot reassign pick'
);

-- 22) week_id is immutable
SELECT tests.authenticate_as((SELECT commish FROM test_ids));
SELECT throws_ok(
  format(
    'UPDATE public.picks SET week_id = %L WHERE id = %L',
    (SELECT week2 FROM test_ids),
    (SELECT locked_pick_id FROM test_ids)
  ),
  'week_id is immutable'
);

-- 23) submitted_at is immutable
SELECT tests.authenticate_as((SELECT commish FROM test_ids));
SELECT throws_ok(
  format(
    'UPDATE public.picks SET submitted_at = %L WHERE id = %L',
    '2020-01-01 00:00:00+00',
    (SELECT locked_pick_id FROM test_ids)
  ),
  'submitted_at is immutable'
);

-- 24) Insert submitted_at cannot be spoofed
SELECT tests.authenticate_as((SELECT player2 FROM test_ids));
SELECT ok(
  (
    WITH inserted AS (
      INSERT INTO public.picks (week_id, user_id, team_id, submitted_at, updated_at)
      VALUES (
        (SELECT week_open FROM test_ids),
        (SELECT player2 FROM test_ids),
        (SELECT team_buf FROM test_ids),
        '2020-01-01 00:00:00+00',
        '2020-01-01 00:00:00+00'
      )
      RETURNING submitted_at, updated_at
    )
    SELECT
      submitted_at > timestamptz '2021-01-01'
      AND updated_at > timestamptz '2021-01-01'
      AND submitted_at > now() - interval '1 minute'
      AND updated_at > now() - interval '1 minute'
    FROM inserted
  ),
  'player cannot spoof submitted_at or updated_at on insert'
);

-- 25) Commissioner can change result but cannot reassign (result ok path)
SELECT tests.authenticate_as((SELECT commish FROM test_ids));
SELECT lives_ok(
  format(
    'UPDATE public.picks SET result = %L WHERE id = %L',
    'loss',
    (SELECT locked_pick_id FROM test_ids)
  ),
  'commissioner can change a result'
);

-- 26) playoff_round_id is immutable
SELECT tests.authenticate_as((SELECT player1 FROM test_ids));
SELECT throws_ok(
  format(
    'UPDATE public.playoff_picks SET playoff_round_id = %L WHERE playoff_round_id = %L AND user_id = %L',
    (SELECT round2 FROM test_ids),
    (SELECT round1 FROM test_ids),
    (SELECT player1 FROM test_ids)
  ),
  'playoff_round_id is immutable'
);

SELECT * FROM finish();

ROLLBACK;
