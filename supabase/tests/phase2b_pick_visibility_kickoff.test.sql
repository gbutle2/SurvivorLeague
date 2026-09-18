-- Kickoff-based pick SELECT visibility (migration 20260918210000).
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

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
  v_player1 UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae01';
  v_player2 UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae02';
  v_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae03';
  v_league UUID := 'cccccccc-cccc-cccc-cccc-ccccccccce01';
  v_season UUID := 'dddddddd-dddd-dddd-dddd-ddddddddde01';
  v_week UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';
  v_team_early UUID;
  v_team_late UUID;
  v_team_legacy UUID;
  v_game_early UUID := 'ffffffff-ffff-ffff-ffff-ffffffffffe1';
  v_game_late UUID := 'ffffffff-ffff-ffff-ffff-ffffffffffe2';
  v_pick_early UUID := '99999999-9999-9999-9999-9999999999e1';
  v_pick_late UUID := '99999999-9999-9999-9999-9999999999e2';
  v_pick_legacy UUID := '99999999-9999-9999-9999-9999999999e3';
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', v_player1, 'authenticated', 'authenticated',
     'vis-p1@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Vis P1"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_player2, 'authenticated', 'authenticated',
     'vis-p2@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Vis P2"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_commish, 'authenticated', 'authenticated',
     'vis-commish@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Vis Commish"}', now(), now());

  INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
  VALUES (v_league, 'Visibility League', 'pick-visibility', 'America/Chicago', v_commish);

  INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
    (v_league, v_commish, 'commissioner', true),
    (v_league, v_player1, 'player', true),
    (v_league, v_player2, 'player', true);

  INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
  VALUES (v_season, v_league, 2095, 'active', 18);

  -- Week is already locked; late game has NOT kicked off yet.
  -- Old week-level policy would leak the late pick; kickoff policy must not.
  INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status)
  VALUES (v_week, v_season, 1, 'Week 1', now() - interval '1 hour', 'locked');

  SELECT id INTO v_team_early FROM public.teams WHERE abbreviation = 'KC';
  SELECT id INTO v_team_late FROM public.teams WHERE abbreviation = 'BUF';
  SELECT id INTO v_team_legacy FROM public.teams WHERE abbreviation = 'SF';

  INSERT INTO public.games (
    id, provider, provider_game_id, season_year, season_type, regular_week_number,
    home_team_id, away_team_id, scheduled_kickoff_at, status
  ) VALUES
    (v_game_early, 'nflverse', 'vis-early', 2095, 'regular', 1,
     v_team_early, v_team_legacy,
     now() - interval '2 hours', 'in_progress'),
    (v_game_late, 'nflverse', 'vis-late', 2095, 'regular', 1,
     v_team_late, (SELECT id FROM public.teams WHERE abbreviation = 'MIA'),
     now() + interval '2 days', 'scheduled');

  INSERT INTO public.picks (id, week_id, user_id, team_id, result)
  VALUES
    (v_pick_early, v_week, v_player1, v_team_early, 'pending'),
    (v_pick_late, v_week, v_player2, v_team_late, 'pending'),
    (v_pick_legacy, v_week, v_commish, v_team_legacy, 'pending');

  -- Simulate a legacy row that never received game provenance.
  ALTER TABLE public.picks DISABLE TRIGGER USER;
  UPDATE public.picks SET game_id = NULL WHERE id = v_pick_legacy;
  ALTER TABLE public.picks ENABLE TRIGGER USER;

  CREATE TEMP TABLE vis_ids AS
  SELECT
    v_player1 AS player1,
    v_player2 AS player2,
    v_commish AS commish,
    v_week AS week_id,
    v_pick_early AS pick_early,
    v_pick_late AS pick_late,
    v_pick_legacy AS pick_legacy,
    v_game_late AS game_late;
END;
$$;

GRANT SELECT ON vis_ids TO authenticated;

-- 1) Owner can always read their own pre-kickoff pick
SELECT tests.authenticate_as((SELECT player2 FROM vis_ids));
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.picks
    WHERE id = (SELECT pick_late FROM vis_ids)
  ),
  1,
  'owner can read own pick before kickoff'
);

-- 2) Peer cannot read another player's pick before that game's kickoff
SELECT tests.authenticate_as((SELECT player1 FROM vis_ids));
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.picks
    WHERE id = (SELECT pick_late FROM vis_ids)
  ),
  0,
  'peer cannot read another pick before kickoff'
);

-- 3) Peer also cannot infer submission via week-scoped counts for the hidden pick
SELECT tests.authenticate_as((SELECT player1 FROM vis_ids));
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.picks
    WHERE week_id = (SELECT week_id FROM vis_ids)
      AND user_id = (SELECT player2 FROM vis_ids)
  ),
  0,
  'peer cannot infer pre-kickoff submission via week count'
);

-- 4) Commissioner has no special pre-kickoff read of another player's pick
SELECT tests.authenticate_as((SELECT commish FROM vis_ids));
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.picks
    WHERE id = (SELECT pick_late FROM vis_ids)
  ),
  0,
  'commissioner cannot read another pick before kickoff'
);

-- 5) Peer can read a pick after that game has kicked off
SELECT tests.authenticate_as((SELECT player2 FROM vis_ids));
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.picks
    WHERE id = (SELECT pick_early FROM vis_ids)
  ),
  1,
  'peer can read another pick after kickoff'
);

-- 6) Locked week alone must not reveal a future-kickoff pick (anti week-level leak)
SELECT tests.authenticate_as((SELECT player1 FROM vis_ids));
SELECT ok(
  public.week_is_locked((SELECT week_id FROM vis_ids))
  AND (
    SELECT count(*)::integer
    FROM public.picks
    WHERE id = (SELECT pick_late FROM vis_ids)
  ) = 0,
  'locked week does not reveal future-kickoff picks'
);

-- 7) Legacy NULL game_id picks become visible once the week is locked
SELECT tests.authenticate_as((SELECT player1 FROM vis_ids));
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.picks
    WHERE id = (SELECT pick_legacy FROM vis_ids)
  ),
  1,
  'legacy null game_id pick visible after week lock'
);

-- 8) Moving kickoff into the past reveals the previously hidden pick
SELECT tests.clear_auth();
UPDATE public.games
SET scheduled_kickoff_at = now() - interval '5 minutes',
    status = 'in_progress'
WHERE id = (SELECT game_late FROM vis_ids);

SELECT tests.authenticate_as((SELECT player1 FROM vis_ids));
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.picks
    WHERE id = (SELECT pick_late FROM vis_ids)
  ),
  1,
  'pick becomes visible after kickoff moves into the past'
);

-- 9) Postponement that pushes kickoff into the future hides the pick again
SELECT tests.clear_auth();
UPDATE public.games
SET scheduled_kickoff_at = now() + interval '3 days',
    status = 'postponed'
WHERE id = (SELECT game_late FROM vis_ids);

SELECT tests.authenticate_as((SELECT player1 FROM vis_ids));
SELECT is(
  (
    SELECT count(*)::integer
    FROM public.picks
    WHERE id = (SELECT pick_late FROM vis_ids)
  ),
  0,
  'postponed future kickoff hides the pick again'
);

-- 10) Owner still sees their own postponed pick
SELECT tests.authenticate_as((SELECT player2 FROM vis_ids));
SELECT is(
  (
    SELECT team_id IS NOT NULL
    FROM public.picks
    WHERE id = (SELECT pick_late FROM vis_ids)
  ),
  true,
  'owner still sees own postponed pick'
);

SELECT * FROM finish();
ROLLBACK;
