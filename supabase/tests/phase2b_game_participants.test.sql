-- Phase 2B-B corrections: one team appearance per week/round.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(8);

DO $$
DECLARE
  v_home UUID;
  v_away UUID;
BEGIN
  SELECT id INTO v_home FROM public.teams WHERE abbreviation = 'KC';
  SELECT id INTO v_away FROM public.teams WHERE abbreviation = 'BUF';

  INSERT INTO public.games (
    id, provider, provider_game_id, season_year, season_type, regular_week_number,
    home_team_id, away_team_id, scheduled_kickoff_at, status
  ) VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01', 'nflverse', 'part-ok', 2092, 'regular', 1,
    v_home, v_away, now() + interval '2 days', 'scheduled'
  );
END;
$$;

SELECT lives_ok(
  $$INSERT INTO public.games (
      provider, provider_game_id, season_year, season_type, regular_week_number,
      home_team_id, away_team_id, scheduled_kickoff_at, status
    )
    SELECT 'nflverse', 'part-other', 2092, 'regular', 1,
           (SELECT id FROM public.teams WHERE abbreviation = 'MIA'),
           (SELECT id FROM public.teams WHERE abbreviation = 'NYJ'),
           now() + interval '2 days', 'scheduled'$$,
  'distinct teams in same week are allowed'
);

SELECT throws_ok(
  $$INSERT INTO public.games (
      provider, provider_game_id, season_year, season_type, regular_week_number,
      home_team_id, away_team_id, scheduled_kickoff_at, status
    )
    SELECT 'nflverse', 'part-home-home', 2092, 'regular', 1,
           (SELECT id FROM public.teams WHERE abbreviation = 'KC'),
           (SELECT id FROM public.teams WHERE abbreviation = 'CHI'),
           now() + interval '2 days', 'scheduled'$$,
  '23505',
  'Team already appears in another non-canceled game for this week/round',
  'rejects home/home duplication across games'
);

SELECT throws_ok(
  $$INSERT INTO public.games (
      provider, provider_game_id, season_year, season_type, regular_week_number,
      home_team_id, away_team_id, scheduled_kickoff_at, status
    )
    SELECT 'nflverse', 'part-away-away', 2092, 'regular', 1,
           (SELECT id FROM public.teams WHERE abbreviation = 'CHI'),
           (SELECT id FROM public.teams WHERE abbreviation = 'BUF'),
           now() + interval '2 days', 'scheduled'$$,
  '23505',
  'Team already appears in another non-canceled game for this week/round',
  'rejects away/away duplication across games'
);

SELECT throws_ok(
  $$INSERT INTO public.games (
      provider, provider_game_id, season_year, season_type, regular_week_number,
      home_team_id, away_team_id, scheduled_kickoff_at, status
    )
    SELECT 'nflverse', 'part-home-away', 2092, 'regular', 1,
           (SELECT id FROM public.teams WHERE abbreviation = 'DEN'),
           (SELECT id FROM public.teams WHERE abbreviation = 'KC'),
           now() + interval '2 days', 'scheduled'$$,
  '23505',
  'Team already appears in another non-canceled game for this week/round',
  'rejects home/away cross duplication'
);

SELECT lives_ok(
  $$UPDATE public.games SET status = 'canceled'
    WHERE provider_game_id = 'part-ok' AND season_year = 2092$$,
  'canceling a game releases participant slots'
);

SELECT lives_ok(
  $$INSERT INTO public.games (
      provider, provider_game_id, season_year, season_type, regular_week_number,
      home_team_id, away_team_id, scheduled_kickoff_at, status
    )
    SELECT 'nflverse', 'part-replacement', 2092, 'regular', 1,
           (SELECT id FROM public.teams WHERE abbreviation = 'KC'),
           (SELECT id FROM public.teams WHERE abbreviation = 'BUF'),
           now() + interval '3 days', 'scheduled'$$,
  'canceled-game replacement with same teams is allowed'
);

SELECT throws_ok(
  $$INSERT INTO public.games (
      provider, provider_game_id, season_year, season_type, playoff_round,
      home_team_id, away_team_id, scheduled_kickoff_at, status
    )
    SELECT 'nflverse', 'part-wc-1', 2092, 'postseason', 'wildcard',
           (SELECT id FROM public.teams WHERE abbreviation = 'SF'),
           (SELECT id FROM public.teams WHERE abbreviation = 'DAL'),
           now() + interval '10 days', 'scheduled';
     INSERT INTO public.games (
      provider, provider_game_id, season_year, season_type, playoff_round,
      home_team_id, away_team_id, scheduled_kickoff_at, status
    )
    SELECT 'nflverse', 'part-wc-2', 2092, 'postseason', 'wildcard',
           (SELECT id FROM public.teams WHERE abbreviation = 'PHI'),
           (SELECT id FROM public.teams WHERE abbreviation = 'SF'),
           now() + interval '10 days', 'scheduled'$$,
  '23505',
  'Team already appears in another non-canceled game for this week/round',
  'rejects playoff home/away cross duplication in same round'
);

SELECT throws_ok(
  $$UPDATE public.games
     SET home_team_id = (SELECT id FROM public.teams WHERE abbreviation = 'KC')
     WHERE provider_game_id = 'part-other' AND season_year = 2092$$,
  '23505',
  'Team already appears in another non-canceled game for this week/round',
  'rejects conflicts created by changing teams on an existing game'
);

SELECT * FROM finish();
ROLLBACK;
