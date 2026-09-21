-- Phase 2B-B: kickoff-based pick authorization.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(12);

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
  v_player UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaad01';
  v_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaad02';
  v_league UUID := 'cccccccc-cccc-cccc-cccc-cccccccccd01';
  v_season UUID := 'dddddddd-dddd-dddd-dddd-dddddddddd01';
  v_w1 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeed01';
  v_w2 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeed02';
  v_team_thu UUID;
  v_team_sun UUID;
  v_team_bye UUID;
  v_team_reuse UUID;
  v_team_mia UUID;
  v_game_thu UUID := 'ffffffff-ffff-ffff-ffff-ffffffffff01';
  v_game_sun UUID := 'ffffffff-ffff-ffff-ffff-ffffffffff02';
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', v_player, 'authenticated', 'authenticated',
     'kick-player@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Kick Player"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_commish, 'authenticated', 'authenticated',
     'kick-commish@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Kick Commish"}', now(), now());

  INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
  VALUES (v_league, 'Kick League', 'kick-locks', 'America/Chicago', v_commish);

  INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
    (v_league, v_commish, 'commissioner', true),
    (v_league, v_player, 'player', true);

  INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
  VALUES (v_season, v_league, 2096, 'active', 18);

  INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status) VALUES
    (v_w1, v_season, 1, 'Week 1', now() + interval '7 days', 'upcoming'),
    (v_w2, v_season, 2, 'Week 2', now() + interval '14 days', 'upcoming');

  SELECT id INTO v_team_thu FROM public.teams WHERE abbreviation = 'KC';
  SELECT id INTO v_team_sun FROM public.teams WHERE abbreviation = 'BUF';
  SELECT id INTO v_team_bye FROM public.teams WHERE abbreviation = 'CHI';
  SELECT id INTO v_team_reuse FROM public.teams WHERE abbreviation = 'SF';
  SELECT id INTO v_team_mia FROM public.teams WHERE abbreviation = 'MIA';

  INSERT INTO public.games (
    id, provider, provider_game_id, season_year, season_type, regular_week_number,
    home_team_id, away_team_id, scheduled_kickoff_at, status
  ) VALUES
    (v_game_thu, 'nflverse', 'kick-thu', 2096, 'regular', 1,
     v_team_thu, v_team_reuse, now() - interval '1 hour', 'in_progress'),
    (v_game_sun, 'nflverse', 'kick-sun', 2096, 'regular', 1,
     v_team_sun, v_team_mia, now() + interval '2 days', 'scheduled');

  CREATE TEMP TABLE kick_ids AS
  SELECT v_player AS player, v_commish AS commissioner, v_season AS season,
         v_w1 AS w1, v_w2 AS w2, v_team_thu AS team_thu, v_team_sun AS team_sun,
         v_team_bye AS team_bye, v_team_reuse AS team_reuse, v_game_thu AS game_thu,
         v_game_sun AS game_sun;
  GRANT SELECT ON kick_ids TO authenticated;
END $$;

SELECT ok(
  public.effective_current_week_id((SELECT season FROM kick_ids))
    = (SELECT w1 FROM kick_ids),
  'effective current week is earliest week with future kickoff'
);

SELECT tests.authenticate_as((SELECT player FROM kick_ids));

SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w1 FROM kick_ids), (SELECT player FROM kick_ids), (SELECT team_bye FROM kick_ids)
  ),
  '23514', NULL, 'bye team cannot be picked'
);

SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w1 FROM kick_ids), (SELECT player FROM kick_ids), (SELECT team_thu FROM kick_ids)
  ),
  '42501', NULL, 'Thursday team locks after kickoff'
);

SELECT lives_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w1 FROM kick_ids), (SELECT player FROM kick_ids), (SELECT team_sun FROM kick_ids)
  ),
  'Sunday team remains selectable before kickoff'
);

SELECT throws_ok(
  format(
    'UPDATE public.picks SET team_id = %L WHERE week_id = %L AND user_id = %L',
    (SELECT team_thu FROM kick_ids), (SELECT w1 FROM kick_ids), (SELECT player FROM kick_ids)
  ),
  '42501', NULL, 'cannot switch to a kicked-off team'
);

SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w2 FROM kick_ids), (SELECT player FROM kick_ids),
    (SELECT id FROM public.teams WHERE abbreviation = 'DET' LIMIT 1)
  ),
  '23514', NULL, 'later NFL week cannot be picked early'
);

SELECT tests.clear_auth();

UPDATE public.games
SET scheduled_kickoff_at = now() - interval '10 minutes', status = 'final',
    home_score = 20, away_score = 10, winner_team_id = (SELECT team_sun FROM kick_ids)
WHERE id = (SELECT game_sun FROM kick_ids);

UPDATE public.games
SET status = 'final', home_score = 27, away_score = 24,
    winner_team_id = (SELECT team_thu FROM kick_ids)
WHERE id = (SELECT game_thu FROM kick_ids);

INSERT INTO public.games (
  provider, provider_game_id, season_year, season_type, regular_week_number,
  home_team_id, away_team_id, scheduled_kickoff_at, status
)
SELECT 'nflverse', 'kick-w2', 2096, 'regular', 2,
       team_bye, team_reuse, now() + interval '3 days', 'scheduled'
FROM kick_ids;

SELECT ok(
  public.effective_current_week_id((SELECT season FROM kick_ids))
    = (SELECT w2 FROM kick_ids),
  'next week becomes current after prior kickoffs finish'
);

SELECT tests.authenticate_as((SELECT player FROM kick_ids));

SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w2 FROM kick_ids), (SELECT player FROM kick_ids), (SELECT team_sun FROM kick_ids)
  ),
  '23514', NULL, 'team reuse blocked'
);

SELECT lives_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w2 FROM kick_ids), (SELECT player FROM kick_ids), (SELECT team_bye FROM kick_ids)
  ),
  'unused team accepted in next week'
);

SELECT tests.clear_auth();

SELECT ok(
  public.team_regular_game_is_unlocked(2096, 1, (SELECT team_thu FROM kick_ids)) = false,
  'post-kickoff game stays locked'
);

SELECT tests.authenticate_as((SELECT commissioner FROM kick_ids));
SELECT lives_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player FROM kick_ids),
    (SELECT w1 FROM kick_ids),
    (SELECT team_thu FROM kick_ids),
    'Kickoff lock test override'
  ),
  'commissioner_override_pick works after kickoff'
);
SELECT tests.clear_auth();

UPDATE public.games
SET scheduled_kickoff_at = now(), status = 'scheduled'
WHERE provider_game_id = 'kick-w2';

SELECT ok(
  public.team_regular_game_is_unlocked(2096, 2, (SELECT team_bye FROM kick_ids)) = false,
  'kickoff equality is locked'
);

SELECT * FROM finish();
ROLLBACK;
