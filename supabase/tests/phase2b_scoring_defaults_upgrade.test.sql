-- Safety coverage for 20260918220000_authoritative_scoring_defaults.sql
-- Proves 17→18 restoration, 18-week no-op, customized scoring preservation,
-- and that Week 18 / picks are never deleted.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

DO $$
DECLARE
  v_league UUID := 'cccccccc-cccc-cccc-cccc-cccccccccf01';
  v_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaf01';
  v_season17 UUID := 'dddddddd-dddd-dddd-dddd-dddddddddf01';
  v_season18 UUID := 'dddddddd-dddd-dddd-dddd-dddddddddf02';
  v_season_custom UUID := 'dddddddd-dddd-dddd-dddd-dddddddddf03';
  v_week18 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeef18';
  v_pick UUID := '99999999-9999-9999-9999-9999999999f1';
  v_team UUID;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', v_commish, 'authenticated', 'authenticated',
    'scoring-defaults@example.com', crypt('x', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{"display_name":"Defaults"}', now(), now()
  );

  INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
  VALUES (v_league, 'Defaults League', 'scoring-defaults', 'America/Chicago', v_commish);

  INSERT INTO public.league_members (league_id, user_id, role, active)
  VALUES (v_league, v_commish, 'commissioner', true);

  INSERT INTO public.seasons (id, league_id, year, status, regular_week_count) VALUES
    (v_season17, v_league, 2091, 'active', 17),
    (v_season18, v_league, 2092, 'active', 18),
    (v_season_custom, v_league, 2093, 'active', 18);

  INSERT INTO public.scoring_rules (
    season_id, correct_regular_pick_points,
    best_record_bonus, longest_streak_bonus, survivor_bonus,
    wildcard_points, divisional_points, conference_points, superbowl_points
  ) VALUES
    (v_season17, 1, 4, 4, 10, 2, 4, 6, 12),
    (v_season18, 1, 3, 3, 5, 1, 2, 3, 4),
    (v_season_custom, 1, 9, 8, 7, 5, 5, 5, 5);

  INSERT INTO public.playoff_rounds (
    season_id, round_number, round_code, name, points, locks_at, status
  ) VALUES
    (v_season17, 1, 'wildcard', 'Wild Card', 2, now() + interval '30 days', 'upcoming'),
    (v_season17, 2, 'divisional', 'Divisional', 4, now() + interval '37 days', 'upcoming'),
    (v_season_custom, 1, 'wildcard', 'Wild Card', 9, now() + interval '30 days', 'upcoming');

  SELECT id INTO v_team FROM public.teams WHERE abbreviation = 'KC';

  INSERT INTO public.games (
    provider, provider_game_id, season_year, season_type, regular_week_number,
    home_team_id, away_team_id, scheduled_kickoff_at, status
  ) VALUES (
    'nflverse', 'scoring-defaults-w18', 2091, 'regular', 18,
    v_team, (SELECT id FROM public.teams WHERE abbreviation = 'BUF'),
    now() + interval '2 days', 'scheduled'
  );

  INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status)
  VALUES (v_week18, v_season17, 18, 'Week 18', now() + interval '1 day', 'upcoming');

  INSERT INTO public.picks (id, week_id, user_id, team_id, result)
  VALUES (v_pick, v_week18, v_commish, v_team, 'pending');
END;
$$;

-- Re-apply the not-yet-remote migration body against the fixture state.
-- The test container does not mount ../migrations, so the upgrade path is
-- re-executed inline rather than via \ir.
ALTER TABLE public.seasons
  ALTER COLUMN regular_week_count SET DEFAULT 18;

ALTER TABLE public.scoring_rules
  ALTER COLUMN best_record_bonus SET DEFAULT 3,
  ALTER COLUMN longest_streak_bonus SET DEFAULT 3,
  ALTER COLUMN survivor_bonus SET DEFAULT 5,
  ALTER COLUMN wildcard_points SET DEFAULT 1,
  ALTER COLUMN divisional_points SET DEFAULT 2,
  ALTER COLUMN conference_points SET DEFAULT 3,
  ALTER COLUMN superbowl_points SET DEFAULT 4;

UPDATE public.seasons
SET regular_week_count = 18
WHERE regular_week_count = 17;

UPDATE public.scoring_rules
SET
  best_record_bonus = 3,
  longest_streak_bonus = 3,
  survivor_bonus = 5,
  wildcard_points = 1,
  divisional_points = 2,
  conference_points = 3,
  superbowl_points = 4
WHERE best_record_bonus = 4
  AND longest_streak_bonus = 4
  AND survivor_bonus = 10
  AND wildcard_points = 2
  AND divisional_points = 4
  AND conference_points = 6
  AND superbowl_points = 12;

UPDATE public.playoff_rounds
SET points = 1
WHERE round_code = 'wildcard' AND points = 2;

UPDATE public.playoff_rounds
SET points = 2
WHERE round_code = 'divisional' AND points = 4;

UPDATE public.playoff_rounds
SET points = 3
WHERE round_code = 'conference' AND points = 6;

UPDATE public.playoff_rounds
SET points = 4
WHERE round_code = 'superbowl' AND points = 12;

SELECT is(
  (SELECT regular_week_count FROM public.seasons WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddf01'),
  18,
  'temporary 17-week seasons restore to 18'
);

SELECT is(
  (SELECT regular_week_count FROM public.seasons WHERE id = 'dddddddd-dddd-dddd-dddd-dddddddddf02'),
  18,
  'existing 18-week seasons remain 18'
);

SELECT is(
  (SELECT best_record_bonus FROM public.scoring_rules WHERE season_id = 'dddddddd-dddd-dddd-dddd-dddddddddf01'),
  3,
  'legacy best-record bonus becomes 3'
);

SELECT is(
  (SELECT survivor_bonus FROM public.scoring_rules WHERE season_id = 'dddddddd-dddd-dddd-dddd-dddddddddf01'),
  5,
  'legacy survivor bonus becomes 5'
);

SELECT is(
  (SELECT wildcard_points FROM public.scoring_rules WHERE season_id = 'dddddddd-dddd-dddd-dddd-dddddddddf01'),
  1,
  'legacy wildcard points become 1'
);

SELECT is(
  (SELECT best_record_bonus FROM public.scoring_rules WHERE season_id = 'dddddddd-dddd-dddd-dddd-dddddddddf02'),
  3,
  'already-correct best-record bonus stays 3'
);

SELECT is(
  (SELECT best_record_bonus FROM public.scoring_rules WHERE season_id = 'dddddddd-dddd-dddd-dddd-dddddddddf03'),
  9,
  'customized best-record bonus is preserved'
);

SELECT is(
  (SELECT points FROM public.playoff_rounds
   WHERE season_id = 'dddddddd-dddd-dddd-dddd-dddddddddf03' AND round_code = 'wildcard'),
  9,
  'customized playoff round points are preserved'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.weeks WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeef18'),
  'Week 18 row is retained'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.picks WHERE id = '99999999-9999-9999-9999-9999999999f1'),
  'existing Week 18 pick is retained'
);

SELECT * FROM finish();
ROLLBACK;
