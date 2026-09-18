-- Phase 2B-A/B: effective current week from NFL games schedule.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

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
  v_player UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac01';
  v_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaac03';
  v_league UUID := 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  v_season UUID := 'dddddddd-dddd-dddd-dddd-dddddddddc01';
  v_w1 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeec01';
  v_w2 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeec02';
  v_w3 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeec03';
  v_team_kc UUID;
  v_team_buf UUID;
  v_team_det UUID;
  v_team_mia UUID;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', v_player, 'authenticated', 'authenticated',
     'eff2-player@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Eff2 Player"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_commish, 'authenticated', 'authenticated',
     'eff2-commish@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Eff2 Commish"}', now(), now());

  INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
  VALUES (v_league, 'Eff2 League', 'eff-current-2', 'America/Chicago', v_commish);

  INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
    (v_league, v_commish, 'commissioner', true),
    (v_league, v_player, 'player', true);

  INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
  VALUES (v_season, v_league, 2097, 'active', 18);

  INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status) VALUES
    (v_w1, v_season, 1, 'W1', now() - interval '7 days', 'final'),
    (v_w2, v_season, 2, 'W2', now() + interval '2 days', 'upcoming'),
    (v_w3, v_season, 3, 'W3', now() + interval '9 days', 'upcoming');

  SELECT id INTO v_team_kc FROM public.teams WHERE abbreviation = 'KC';
  SELECT id INTO v_team_buf FROM public.teams WHERE abbreviation = 'BUF';
  SELECT id INTO v_team_det FROM public.teams WHERE abbreviation = 'DET';
  SELECT id INTO v_team_mia FROM public.teams WHERE abbreviation = 'MIA';

  INSERT INTO public.games (
    provider, provider_game_id, season_year, season_type, regular_week_number,
    home_team_id, away_team_id, scheduled_kickoff_at, status, home_score, away_score, winner_team_id
  ) VALUES
    ('nflverse', 'eff2-w1', 2097, 'regular', 1, v_team_kc, v_team_buf,
     now() - interval '8 days', 'final', 21, 14, v_team_kc),
    ('nflverse', 'eff2-w2', 2097, 'regular', 2, v_team_det, v_team_mia,
     now() + interval '2 days', 'scheduled', NULL, NULL, NULL),
    ('nflverse', 'eff2-w3', 2097, 'regular', 3, v_team_kc, v_team_mia,
     now() + interval '9 days', 'scheduled', NULL, NULL, NULL);

  CREATE TEMP TABLE eff2_ids AS
  SELECT v_player AS player, v_season AS season_id, v_w1 AS w1, v_w2 AS w2, v_w3 AS w3,
         v_team_det AS team_det, v_team_mia AS team_mia;
  GRANT SELECT ON eff2_ids TO authenticated;
END $$;

SELECT ok(
  public.effective_current_week_id((SELECT season_id FROM eff2_ids))
    = (SELECT w2 FROM eff2_ids),
  'Week 2 is effective after Week 1 finals'
);

SELECT tests.authenticate_as((SELECT player FROM eff2_ids));
SELECT lives_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w2 FROM eff2_ids),
    (SELECT player FROM eff2_ids),
    (SELECT team_det FROM eff2_ids)
  ),
  'earliest eligible future week accepts a pick'
);

SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w3 FROM eff2_ids),
    (SELECT player FROM eff2_ids),
    (SELECT team_mia FROM eff2_ids)
  ),
  '42501',
  NULL,
  'later future week rejects a pick'
);

SELECT tests.clear_auth();

UPDATE public.games
SET scheduled_kickoff_at = now() - interval '1 hour', status = 'final',
    home_score = 10, away_score = 7, winner_team_id = (SELECT team_det FROM eff2_ids)
WHERE provider_game_id = 'eff2-w2';

SELECT ok(
  public.effective_current_week_id((SELECT season_id FROM eff2_ids))
    = (SELECT w3 FROM eff2_ids),
  'Week 3 becomes effective automatically after Week 2 completes'
);

SELECT tests.authenticate_as((SELECT player FROM eff2_ids));
UPDATE public.picks
SET team_id = (SELECT team_mia FROM eff2_ids)
WHERE week_id = (SELECT w2 FROM eff2_ids)
  AND user_id = (SELECT player FROM eff2_ids);
SELECT is(
  (
    SELECT team_id
    FROM public.picks
    WHERE week_id = (SELECT w2 FROM eff2_ids)
      AND user_id = (SELECT player FROM eff2_ids)
  ),
  (SELECT team_det FROM eff2_ids),
  'cannot update pick after week is no longer effective'
);

SELECT tests.clear_auth();

SELECT * FROM finish();
ROLLBACK;
