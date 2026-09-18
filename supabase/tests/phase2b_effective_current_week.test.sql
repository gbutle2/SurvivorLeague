-- Phase 2B-A: effective current week authorization (deadline-based).
-- Run via: npm run test:db

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(11);

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

SELECT tests.clear_auth();

DO $$
DECLARE
  v_player UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01';
  v_inactive UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab02';
  v_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab03';
  v_league UUID := 'cccccccc-cccc-cccc-cccc-cccccccccb01';
  v_season UUID := 'dddddddd-dddd-dddd-dddd-dddddddddb01';
  v_w1 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeb01';
  v_w2 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeb02';
  v_w3 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeb03';
  v_w4 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeb04';
  v_team_kc UUID;
  v_team_buf UUID;
  v_team_det UUID;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', v_player, 'authenticated', 'authenticated',
     'eff-player@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Eff Player"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_inactive, 'authenticated', 'authenticated',
     'eff-inactive@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Eff Inactive"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_commish, 'authenticated', 'authenticated',
     'eff-commish@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Eff Commish"}', now(), now());

  INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
  VALUES (v_league, 'Eff League', 'eff-current', 'America/Chicago', v_commish);

  INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
    (v_league, v_commish, 'commissioner', true),
    (v_league, v_player, 'player', true),
    (v_league, v_inactive, 'player', false);

  INSERT INTO public.seasons (id, league_id, year, status)
  VALUES (v_season, v_league, 2098, 'active');

  INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status) VALUES
    (v_w1, v_season, 1, 'W1', now() - interval '7 days', 'final'),
    (v_w2, v_season, 2, 'W2', now() + interval '2 days', 'upcoming'),
    (v_w3, v_season, 3, 'W3', now() + interval '9 days', 'upcoming'),
    (v_w4, v_season, 4, 'W4', now() + interval '16 days', 'open');

  SELECT id INTO v_team_kc FROM public.teams WHERE abbreviation = 'KC';
  SELECT id INTO v_team_buf FROM public.teams WHERE abbreviation = 'BUF';
  SELECT id INTO v_team_det FROM public.teams WHERE abbreviation = 'DET';

  CREATE TEMP TABLE eff_ids AS
  SELECT
    v_player AS player,
    v_inactive AS inactive,
    v_w1 AS w1,
    v_w2 AS w2,
    v_w3 AS w3,
    v_w4 AS w4,
    v_team_kc AS team_kc,
    v_team_buf AS team_buf,
    v_team_det AS team_det,
    v_season AS season_id;

  GRANT SELECT ON eff_ids TO authenticated;
END;
$$;

-- 1) Earliest eligible future week accepts a pick
SELECT tests.authenticate_as((SELECT player FROM eff_ids));
SELECT lives_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w2 FROM eff_ids),
    (SELECT player FROM eff_ids),
    (SELECT team_kc FROM eff_ids)
  ),
  'earliest eligible future week accepts a pick'
);

-- 2) Later future week rejects a pick
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w3 FROM eff_ids),
    (SELECT player FROM eff_ids),
    (SELECT team_buf FROM eff_ids)
  ),
  '42501',
  NULL,
  'later future week rejects a pick'
);

-- 3) Explicit open on a later week cannot bypass earlier effective week
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w4 FROM eff_ids),
    (SELECT player FROM eff_ids),
    (SELECT team_det FROM eff_ids)
  ),
  '42501',
  NULL,
  'explicit open on a later week cannot bypass earlier effective week'
);

-- 4) Deadline equality rejects a pick
SELECT tests.clear_auth();
DELETE FROM public.picks
WHERE week_id = (SELECT w2 FROM eff_ids)
  AND user_id = (SELECT player FROM eff_ids);
UPDATE public.weeks
SET locks_at = now()
WHERE id = (SELECT w2 FROM eff_ids);

SELECT tests.authenticate_as((SELECT player FROM eff_ids));
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w2 FROM eff_ids),
    (SELECT player FROM eff_ids),
    (SELECT team_kc FROM eff_ids)
  ),
  '42501',
  NULL,
  'deadline equality rejects a pick'
);

-- 5) After current deadline passes, next week becomes eligible automatically
SELECT tests.clear_auth();
UPDATE public.weeks
SET locks_at = now() - interval '1 hour', status = 'upcoming'
WHERE id = (SELECT w2 FROM eff_ids);

SELECT ok(
  public.effective_current_week_id((SELECT season_id FROM eff_ids))
    = (SELECT w3 FROM eff_ids),
  'after current deadline passes, next week becomes effective'
);

SELECT tests.authenticate_as((SELECT player FROM eff_ids));
SELECT lives_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w3 FROM eff_ids),
    (SELECT player FROM eff_ids),
    (SELECT team_buf FROM eff_ids)
  ),
  'next week accepts a pick automatically after prior deadline'
);

-- 6) Locked current candidate is skipped
SELECT tests.clear_auth();
UPDATE public.weeks
SET status = 'locked', locks_at = now() + interval '3 days'
WHERE id = (SELECT w3 FROM eff_ids);

SELECT ok(
  public.effective_current_week_id((SELECT season_id FROM eff_ids))
    = (SELECT w4 FROM eff_ids),
  'locked current candidate is skipped'
);

-- 7) Final weeks are skipped (Week 1 already final)
SELECT ok(
  public.week_is_effective_current((SELECT w1 FROM eff_ids)) = false,
  'final weeks are skipped'
);

-- 8) Inactive member is rejected
SELECT tests.authenticate_as((SELECT inactive FROM eff_ids));
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w4 FROM eff_ids),
    (SELECT inactive FROM eff_ids),
    (SELECT team_det FROM eff_ids)
  ),
  '42501',
  NULL,
  'inactive member is rejected'
);

-- 9) Reused team is rejected on the effective week
SELECT tests.authenticate_as((SELECT player FROM eff_ids));
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w4 FROM eff_ids),
    (SELECT player FROM eff_ids),
    (SELECT team_buf FROM eff_ids)
  ),
  '23514',
  NULL,
  'reused team is rejected'
);

-- 10) UI/stored open status does not grant authority by itself
SELECT tests.clear_auth();
SELECT ok(
  public.week_is_effective_current((SELECT w4 FROM eff_ids)) = true
  AND public.week_is_effective_current((SELECT w3 FROM eff_ids)) = false,
  'UI status does not grant authority; database effective week remains singular'
);

SELECT * FROM finish();
ROLLBACK;
