-- Phase 2B-B: playoff advancement requires prior result = win.
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

SELECT plan(8);

SELECT tests.clear_auth();

DO $$
DECLARE
  v_player UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';
  v_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02';
  v_league UUID := 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  v_season UUID := 'dddddddd-dddd-dddd-dddd-dddddddddd01';
  v_wc UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';
  v_div UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02';
  v_con UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03';
  v_team_a UUID;
  v_team_b UUID;
  v_team_c UUID;
  v_team_d UUID;
  v_team_e UUID;
  v_team_f UUID;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', v_player, 'authenticated', 'authenticated',
     'pf-player@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"PF Player"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_commish, 'authenticated', 'authenticated',
     'pf-commish@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"PF Commish"}', now(), now());

  INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
  VALUES (v_league, 'PF League', 'playoff-elig', 'America/Chicago', v_commish);

  INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
    (v_league, v_commish, 'commissioner', true),
    (v_league, v_player, 'player', true);

  INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
  VALUES (v_season, v_league, 2094, 'active', 18);

  INSERT INTO public.playoff_rounds (
    id, season_id, round_number, round_code, name, points, locks_at, status
  ) VALUES
    (v_wc, v_season, 1, 'wildcard', 'Wild Card', 2, now() - interval '7 days', 'locked'),
    (v_div, v_season, 2, 'divisional', 'Divisional', 4, now() + interval '2 days', 'open'),
    (v_con, v_season, 3, 'conference', 'Conference', 6, now() + interval '9 days', 'upcoming');

  SELECT id INTO v_team_a FROM public.teams WHERE abbreviation = 'KC';
  SELECT id INTO v_team_b FROM public.teams WHERE abbreviation = 'BUF';
  SELECT id INTO v_team_c FROM public.teams WHERE abbreviation = 'BAL';
  SELECT id INTO v_team_d FROM public.teams WHERE abbreviation = 'HOU';
  SELECT id INTO v_team_e FROM public.teams WHERE abbreviation = 'SF';
  SELECT id INTO v_team_f FROM public.teams WHERE abbreviation = 'DET';

  INSERT INTO public.games (
    provider, provider_game_id, season_year, season_type, playoff_round,
    home_team_id, away_team_id, scheduled_kickoff_at, status,
    home_score, away_score, winner_team_id
  ) VALUES (
    'nflverse', 'pf-wc', 2094, 'postseason', 'wildcard',
    v_team_a, v_team_b, now() - interval '3 days', 'final',
    24, 10, v_team_a
  );

  INSERT INTO public.games (
    provider, provider_game_id, season_year, season_type, playoff_round,
    home_team_id, away_team_id, scheduled_kickoff_at, status
  ) VALUES (
    'nflverse', 'pf-div', 2094, 'postseason', 'divisional',
    v_team_c, v_team_d, now() + interval '1 day', 'scheduled'
  );

  INSERT INTO public.games (
    provider, provider_game_id, season_year, season_type, playoff_round,
    home_team_id, away_team_id, scheduled_kickoff_at, status
  ) VALUES (
    'nflverse', 'pf-con', 2094, 'postseason', 'conference',
    v_team_e, v_team_f, now() + interval '8 days', 'scheduled'
  );
END;
$$;

SELECT is(
  public.player_eligible_for_playoff_round(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
  ),
  false,
  'missed prior pick blocks advancement'
);

INSERT INTO public.playoff_picks (
  playoff_round_id, user_id, team_id, result, points_awarded, result_source
) VALUES (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  (SELECT id FROM public.teams WHERE abbreviation = 'KC'),
  'pending', 0, 'auto'
);

SELECT is(
  public.player_eligible_for_playoff_round(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
  ),
  false,
  'pending prior result blocks advancement'
);

UPDATE public.playoff_picks SET result = 'loss'
WHERE playoff_round_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
  AND user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';

SELECT is(
  public.player_eligible_for_playoff_round(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
  ),
  false,
  'loss prior result blocks advancement'
);

UPDATE public.playoff_picks SET result = 'tie'
WHERE playoff_round_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
  AND user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';

SELECT is(
  public.player_eligible_for_playoff_round(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
  ),
  false,
  'tie prior result blocks advancement'
);

UPDATE public.playoff_picks SET result = 'win'
WHERE playoff_round_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
  AND user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';

SELECT is(
  public.player_eligible_for_playoff_round(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
  ),
  true,
  'win permits advancement into the next round'
);

UPDATE public.games
SET status = 'scheduled', home_score = NULL, away_score = NULL, winner_team_id = NULL,
    scheduled_kickoff_at = now() + interval '1 hour'
WHERE provider_game_id = 'pf-wc';

SELECT is(
  public.player_eligible_for_playoff_round(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
  ),
  false,
  'previous round still underway blocks advancement'
);

UPDATE public.games
SET status = 'final', home_score = 24, away_score = 10,
    winner_team_id = (SELECT id FROM public.teams WHERE abbreviation = 'KC'),
    scheduled_kickoff_at = now() - interval '3 days'
WHERE provider_game_id = 'pf-wc';

SELECT is(
  public.player_eligible_for_playoff_round(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
  ),
  false,
  'all earlier rounds are checked (divisional incomplete blocks conference)'
);

UPDATE public.games
SET status = 'final', home_score = 20, away_score = 17,
    winner_team_id = (SELECT id FROM public.teams WHERE abbreviation = 'BAL'),
    scheduled_kickoff_at = now() - interval '1 day'
WHERE provider_game_id = 'pf-div';

INSERT INTO public.playoff_picks (
  playoff_round_id, user_id, team_id, result, points_awarded, result_source
) VALUES (
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  (SELECT id FROM public.teams WHERE abbreviation = 'BAL'),
  'win', 4, 'auto'
);

SELECT is(
  public.player_eligible_for_playoff_round(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
  ),
  true,
  'wins in all earlier completed rounds permit further advancement'
);

SELECT * FROM finish();
ROLLBACK;
