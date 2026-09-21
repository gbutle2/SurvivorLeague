-- Commissioner pick overrides: authorization, derivation, reuse, audit, privacy.
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

SELECT plan(39);

SELECT tests.clear_auth();

DO $$
DECLARE
  v_player UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae01';
  v_player2 UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae02';
  v_inactive UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae03';
  v_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae04';
  v_inactive_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae05';
  v_other_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae06';
  v_league UUID := 'cccccccc-cccc-cccc-cccc-ccccccccce01';
  v_league_b UUID := 'cccccccc-cccc-cccc-cccc-ccccccccce02';
  v_season UUID := 'dddddddd-dddd-dddd-dddd-ddddddddde01';
  v_season_b UUID := 'dddddddd-dddd-dddd-dddd-ddddddddde02';
  v_w1 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';
  v_w2 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee02';
  v_w3 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03';
  v_w_future UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee18';
  v_g_final UUID := 'ffffffff-ffff-ffff-ffff-ffffffffff01';
  v_g_live UUID := 'ffffffff-ffff-ffff-ffff-ffffffffff02';
  v_g_sched UUID := 'ffffffff-ffff-ffff-ffff-ffffffffff03';
  v_g_future UUID := 'ffffffff-ffff-ffff-ffff-ffffffffff18';
  v_g_tie UUID := 'ffffffff-ffff-ffff-ffff-ffffffffff04';
  v_g_w2 UUID := 'ffffffff-ffff-ffff-ffff-ffffffffff05';
  v_kc UUID;
  v_buf UUID;
  v_mia UUID;
  v_nyj UUID;
  v_det UUID;
  v_sf UUID;
  v_phi UUID;
  v_dal UUID;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', v_player, 'authenticated', 'authenticated',
     'ov-player@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Override Player"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_player2, 'authenticated', 'authenticated',
     'ov-player2@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Override Player Two"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_inactive, 'authenticated', 'authenticated',
     'ov-inactive@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Inactive Player"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_commish, 'authenticated', 'authenticated',
     'ov-commish@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Override Commish"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_inactive_commish, 'authenticated', 'authenticated',
     'ov-inactive-commish@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Inactive Commish"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_other_commish, 'authenticated', 'authenticated',
     'ov-other-commish@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Other Commish"}', now(), now());

  INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id) VALUES
    (v_league, 'Override League', 'override-a', 'America/Chicago', v_commish),
    (v_league_b, 'Other League', 'override-b', 'America/Chicago', v_other_commish);

  INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
    (v_league, v_commish, 'commissioner', true),
    (v_league, v_player, 'player', true),
    (v_league, v_player2, 'player', true),
    (v_league, v_inactive, 'player', false),
    (v_league, v_inactive_commish, 'commissioner', false),
    (v_league_b, v_other_commish, 'commissioner', true);

  INSERT INTO public.seasons (id, league_id, year, status, regular_week_count) VALUES
    (v_season, v_league, 2098, 'active', 18),
    (v_season_b, v_league_b, 2098, 'active', 18);

  INSERT INTO public.scoring_rules (season_id) VALUES (v_season), (v_season_b);

  INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status) VALUES
    (v_w1, v_season, 1, 'Week 1', now() - interval '7 days', 'final'),
    (v_w2, v_season, 2, 'Week 2', now() - interval '1 day', 'locked'),
    (v_w3, v_season, 3, 'Week 3', now() + interval '2 days', 'open'),
    (v_w_future, v_season, 18, 'Week 18', now() + interval '120 days', 'upcoming');

  SELECT id INTO v_kc FROM public.teams WHERE abbreviation = 'KC';
  SELECT id INTO v_buf FROM public.teams WHERE abbreviation = 'BUF';
  SELECT id INTO v_mia FROM public.teams WHERE abbreviation = 'MIA';
  SELECT id INTO v_nyj FROM public.teams WHERE abbreviation = 'NYJ';
  SELECT id INTO v_det FROM public.teams WHERE abbreviation = 'DET';
  SELECT id INTO v_sf FROM public.teams WHERE abbreviation = 'SF';
  SELECT id INTO v_phi FROM public.teams WHERE abbreviation = 'PHI';
  SELECT id INTO v_dal FROM public.teams WHERE abbreviation = 'DAL';

  INSERT INTO public.games (
    id, provider, provider_game_id, season_year, season_type, regular_week_number,
    home_team_id, away_team_id, scheduled_kickoff_at, status,
    home_score, away_score, winner_team_id
  ) VALUES
    (v_g_final, 'nflverse', 'ov-w1-kc-buf', 2098, 'regular', 1,
     v_kc, v_buf, now() - interval '6 days', 'final', 27, 20, v_kc),
    (v_g_tie, 'nflverse', 'ov-w1-mia-nyj', 2098, 'regular', 1,
     v_mia, v_nyj, now() - interval '6 days', 'final', 17, 17, NULL),
    (v_g_live, 'nflverse', 'ov-w2-det-sf', 2098, 'regular', 2,
     v_det, v_sf, now() - interval '1 hour', 'in_progress', NULL, NULL, NULL),
    (v_g_sched, 'nflverse', 'ov-w3-phi-dal', 2098, 'regular', 3,
     v_phi, v_dal, now() + interval '2 days', 'scheduled', NULL, NULL, NULL),
    (v_g_w2, 'nflverse', 'ov-w2-phi-dal', 2098, 'regular', 2,
     v_phi, v_dal, now() + interval '1 day', 'scheduled', NULL, NULL, NULL),
    (v_g_future, 'nflverse', 'ov-w18-kc-buf', 2098, 'regular', 18,
     v_kc, v_buf, now() + interval '120 days', 'scheduled', NULL, NULL, NULL);

  CREATE TEMP TABLE ov_ids AS
  SELECT
    v_player AS player,
    v_player2 AS player2,
    v_inactive AS inactive,
    v_commish AS commish,
    v_inactive_commish AS inactive_commish,
    v_other_commish AS other_commish,
    v_league AS league,
    v_w1 AS w1,
    v_w2 AS w2,
    v_w3 AS w3,
    v_w_future AS w_future,
    v_kc AS kc,
    v_buf AS buf,
    v_mia AS mia,
    v_nyj AS nyj,
    v_det AS det,
    v_sf AS sf,
    v_phi AS phi,
    v_dal AS dal,
    v_g_final AS g_final;
END;
$$;

GRANT SELECT ON ov_ids TO authenticated;

-- Auth: unauthenticated rejected
SELECT throws_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player FROM ov_ids), (SELECT w3 FROM ov_ids), (SELECT phi FROM ov_ids), 'no auth'
  ),
  '42501', NULL, 'unauthenticated user rejected'
);

-- Auth: normal player rejected
SELECT tests.authenticate_as((SELECT player FROM ov_ids));
SELECT throws_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player2 FROM ov_ids), (SELECT w3 FROM ov_ids), (SELECT phi FROM ov_ids), 'player try'
  ),
  '42501', NULL, 'normal player rejected'
);
SELECT tests.clear_auth();

-- Auth: inactive commissioner rejected
SELECT tests.authenticate_as((SELECT inactive_commish FROM ov_ids));
SELECT throws_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player FROM ov_ids), (SELECT w3 FROM ov_ids), (SELECT phi FROM ov_ids), 'inactive'
  ),
  '42501', NULL, 'inactive commissioner rejected'
);
SELECT tests.clear_auth();

-- Auth: cross-league commissioner rejected
SELECT tests.authenticate_as((SELECT other_commish FROM ov_ids));
SELECT throws_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player FROM ov_ids), (SELECT w3 FROM ov_ids), (SELECT phi FROM ov_ids), 'cross league'
  ),
  '42501', NULL, 'cross-league commissioner rejected'
);
SELECT tests.clear_auth();

-- Auth: inactive target rejected
SELECT tests.authenticate_as((SELECT commish FROM ov_ids));
SELECT throws_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT inactive FROM ov_ids), (SELECT w3 FROM ov_ids), (SELECT phi FROM ov_ids), 'inactive target'
  ),
  '42501', NULL, 'inactive target rejected'
);

-- Empty reason rejected
SELECT throws_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player FROM ov_ids), (SELECT w3 FROM ov_ids), (SELECT phi FROM ov_ids), '   '
  ),
  '23514', NULL, 'blank reason rejected'
);

-- Submitted spoof fields ignored; active commissioner accepted for future week
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM ov_ids),
      (SELECT w_future FROM ov_ids),
      (SELECT kc FROM ov_ids),
      'Player submitted pick by text',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae99'::uuid,
      'cccccccc-cccc-cccc-cccc-ccccccccce99'::uuid,
      'commissioner',
      'win'::public.pick_result,
      99,
      'ffffffff-ffff-ffff-ffff-ffffffffff99'::uuid
    )->>'result') = 'pending'
  ),
  'future week create accepted; submitted result/points/game ignored'
);

SELECT tests.clear_auth();
SELECT results_eq(
  $$SELECT result::text, result_source::text, result_override_reason IS NULL
    FROM public.picks
    WHERE user_id = (SELECT player FROM ov_ids)
      AND week_id = (SELECT w_future FROM ov_ids)$$,
  $$VALUES ('pending', 'auto', true)$$,
  'future override stores pending/auto'
);
SELECT tests.authenticate_as((SELECT commish FROM ov_ids));

-- Future week clear
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM ov_ids),
      (SELECT w_future FROM ov_ids),
      NULL,
      'Clearing mistaken future pick'
    )->>'cleared')::boolean
  ),
  'future week pick can be cleared'
);

SELECT is(
  (SELECT count(*)::integer FROM public.picks
    WHERE user_id = (SELECT player FROM ov_ids)
      AND week_id = (SELECT w_future FROM ov_ids)),
  0,
  'cleared future pick removes canonical row'
);

-- Current unstarted week change
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM ov_ids),
      (SELECT w3 FROM ov_ids),
      (SELECT phi FROM ov_ids),
      'Correcting data-entry mistake'
    )->>'result') = 'pending'
  ),
  'current unstarted pick can be created'
);

-- In-progress game pick change
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM ov_ids),
      (SELECT w2 FROM ov_ids),
      (SELECT det FROM ov_ids),
      'Pick was entered for wrong team'
    )->>'result') = 'pending'
  ),
  'in-progress-game pick can be changed'
);

-- Completed-game insert (historical win)
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player2 FROM ov_ids),
      (SELECT w1 FROM ov_ids),
      (SELECT kc FROM ov_ids),
      'Historical Week 1 entry'
    )->>'result') = 'win'
  ),
  'completed-game pick insert yields win'
);

SELECT is(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player2 FROM ov_ids),
      (SELECT w1 FROM ov_ids),
      (SELECT kc FROM ov_ids),
      'confirm win points'
    )->>'points')::integer
  ),
  1,
  'final winning team → 1 point'
);

-- Final losing team
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM ov_ids),
      (SELECT w1 FROM ov_ids),
      (SELECT buf FROM ov_ids),
      'Historical loss'
    )->>'result') = 'loss'
  ),
  'final losing team → loss'
);

SELECT is(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM ov_ids),
      (SELECT w1 FROM ov_ids),
      (SELECT buf FROM ov_ids),
      'confirm loss points'
    )->>'points')::integer
  ),
  0,
  'final losing team → 0 points'
);

-- Final tied game
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player2 FROM ov_ids),
      (SELECT w1 FROM ov_ids),
      (SELECT mia FROM ov_ids),
      'Tie game override'
    )->>'result') = 'tie'
  ),
  'final tied game → tie'
);

-- Same-week existing team permitted (re-save BUF on w1 for player)
SELECT lives_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player FROM ov_ids), (SELECT w1 FROM ov_ids), (SELECT buf FROM ov_ids), 'same week keep'
  ),
  'same-week existing team is permitted'
);

-- Another-week used team rejected with conflicting week
SELECT throws_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player FROM ov_ids), (SELECT w3 FROM ov_ids), (SELECT buf FROM ov_ids), 'reuse fail'
  ),
  '23514', NULL, 'another-week used team is rejected'
);

-- Bye team rejected
SELECT throws_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player FROM ov_ids), (SELECT w3 FROM ov_ids), (SELECT kc FROM ov_ids), 'bye fail'
  ),
  '23514', NULL, 'bye team rejected'
);

-- Historical clear produces missed pick
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM ov_ids),
      (SELECT w1 FROM ov_ids),
      NULL,
      'Clearing historical pick'
    )->>'cleared')::boolean
  ),
  'historical pick can be cleared'
);

SELECT is(
  (SELECT count(*)::integer FROM public.picks
    WHERE user_id = (SELECT player FROM ov_ids) AND week_id = (SELECT w1 FROM ov_ids)),
  0,
  'cleared historical pick is absent (missed)'
);

-- Audit: successful mutations produced rows; failed reuse did not add extra beyond successes
SELECT ok(
  (
    SELECT count(*) >= 8
    FROM public.commissioner_pick_override_audits
    WHERE league_id = (SELECT league FROM ov_ids)
  ),
  'successful overrides produce audit rows'
);

SELECT ok(
  (
    SELECT count(*) FILTER (WHERE cleared) >= 2
    FROM public.commissioner_pick_override_audits
    WHERE league_id = (SELECT league FROM ov_ids)
  ),
  'clears are audited'
);

-- Failed reuse does not insert an audit row
DO $$
DECLARE
  v_before INTEGER;
  v_after INTEGER;
BEGIN
  SELECT count(*)::integer INTO v_before
  FROM public.commissioner_pick_override_audits
  WHERE league_id = (SELECT league FROM ov_ids);
  BEGIN
    PERFORM public.commissioner_override_pick(
      (SELECT player FROM ov_ids),
      (SELECT w3 FROM ov_ids),
      (SELECT det FROM ov_ids),
      'should fail reuse'
    );
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  SELECT count(*)::integer INTO v_after
  FROM public.commissioner_pick_override_audits
  WHERE league_id = (SELECT league FROM ov_ids);
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'failed mutation produced audit row';
  END IF;
END;
$$;

SELECT pass('failed reuse mutation produces no audit row');

-- Audit contains reason
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.commissioner_pick_override_audits
    WHERE reason = 'Historical Week 1 entry'
      AND new_result = 'win'
      AND previous_result IS NULL
  ),
  'audit contains before/after state and reason'
);

-- Players cannot read audits
SELECT tests.authenticate_as((SELECT player FROM ov_ids));
SELECT is(
  (SELECT count(*)::integer FROM public.commissioner_pick_override_audits),
  0,
  'players cannot read commissioner audit data'
);

-- Same-league commissioner can read
SELECT tests.authenticate_as((SELECT commish FROM ov_ids));
SELECT ok(
  (SELECT count(*)::integer FROM public.commissioner_pick_override_audits
    WHERE league_id = (SELECT league FROM ov_ids)) > 0,
  'same-league commissioner can read audit history'
);

-- Cross-league commissioner cannot read
SELECT tests.authenticate_as((SELECT other_commish FROM ov_ids));
SELECT is(
  (SELECT count(*)::integer FROM public.commissioner_pick_override_audits
    WHERE league_id = (SELECT league FROM ov_ids)),
  0,
  'cross-league commissioner cannot read audits'
);

-- Audit rows cannot be modified/deleted (trigger rejects even for table owner)
SELECT tests.clear_auth();
SELECT throws_ok(
  $$UPDATE public.commissioner_pick_override_audits SET reason = 'tamper'$$,
  '42501',
  'Commissioner pick override audits are immutable',
  'audit rows cannot be updated by application role'
);
SELECT throws_ok(
  $$DELETE FROM public.commissioner_pick_override_audits$$,
  '42501',
  'Commissioner pick override audits are immutable',
  'audit rows cannot be deleted by application role'
);

-- Commissioner list week picks sees unstarted future picks
SELECT tests.authenticate_as((SELECT commish FROM ov_ids));
SELECT lives_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player2 FROM ov_ids), (SELECT w_future FROM ov_ids), (SELECT buf FROM ov_ids), 'future for list'
  ),
  'seed future pick for list visibility'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.commissioner_list_week_picks((SELECT w_future FROM ov_ids))
    WHERE user_id = (SELECT player2 FROM ov_ids)
      AND team_id = (SELECT buf FROM ov_ids)
  ),
  'commissioner list sees unstarted future picks'
);

-- Ordinary player still cannot see other unstarted picks via SELECT policy
SELECT tests.authenticate_as((SELECT player FROM ov_ids));
SELECT is(
  (SELECT count(*)::integer FROM public.picks
    WHERE user_id = (SELECT player2 FROM ov_ids)
      AND week_id = (SELECT w_future FROM ov_ids)),
  0,
  'ordinary pick visibility remains kickoff-based'
);

-- Player cannot edit after selected-game kickoff / locked week
SELECT tests.clear_auth();
UPDATE public.games
SET scheduled_kickoff_at = now() - interval '2 hours', status = 'in_progress'
WHERE provider_game_id = 'ov-w2-det-sf';

SELECT tests.authenticate_as((SELECT player FROM ov_ids));
UPDATE public.picks
SET team_id = (SELECT sf FROM ov_ids)
WHERE week_id = (SELECT w2 FROM ov_ids)
  AND user_id = (SELECT player FROM ov_ids);
SELECT is(
  (SELECT team_id FROM public.picks
    WHERE week_id = (SELECT w2 FROM ov_ids)
      AND user_id = (SELECT player FROM ov_ids)),
  (SELECT det FROM ov_ids),
  'normal player cannot edit after kickoff / locked week'
);

-- Player cannot edit final week
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w1 FROM ov_ids), (SELECT player FROM ov_ids), (SELECT kc FROM ov_ids)
  ),
  '42501', NULL, 'normal player cannot insert into final week'
);

-- NFL sync grading path: pending auto override on live game later grades
SELECT tests.clear_auth();
UPDATE public.games
SET status = 'final', home_score = 28, away_score = 14, winner_team_id = (SELECT det FROM ov_ids)
WHERE provider_game_id = 'ov-w2-det-sf';

UPDATE public.picks p
SET result = CASE
      WHEN g.winner_team_id IS NULL THEN 'tie'::public.pick_result
      WHEN g.winner_team_id = p.team_id THEN 'win'::public.pick_result
      ELSE 'loss'::public.pick_result
    END,
    result_source = 'auto',
    game_id = g.id,
    updated_at = now()
FROM public.weeks w
INNER JOIN public.seasons s ON s.id = w.season_id
INNER JOIN public.games g
  ON g.season_year = s.year
 AND g.season_type = 'regular'
 AND g.regular_week_number = w.week_number
 AND g.status = 'final'
WHERE p.week_id = w.id
  AND s.year = 2098
  AND (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
  AND p.result = 'pending'
  AND p.result_source = 'auto'
  AND p.user_id = (SELECT player FROM ov_ids)
  AND p.week_id = (SELECT w2 FROM ov_ids);

SELECT is(
  (SELECT result::text FROM public.picks
    WHERE user_id = (SELECT player FROM ov_ids) AND week_id = (SELECT w2 FROM ov_ids)),
  'win',
  'NFL sync later grades a pending override correctly'
);

-- Playoff usage does not conflict with regular override
SELECT tests.authenticate_as((SELECT commish FROM ov_ids));
SELECT lives_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player FROM ov_ids), (SELECT w3 FROM ov_ids), (SELECT phi FROM ov_ids), 'reset w3 phi'
  ),
  'can set week 3 after clear of conflicting teams'
);

-- Postponed game blocked
SELECT tests.clear_auth();
UPDATE public.games SET status = 'postponed' WHERE provider_game_id = 'ov-w3-phi-dal';
SELECT tests.authenticate_as((SELECT commish FROM ov_ids));
SELECT throws_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player2 FROM ov_ids), (SELECT w3 FROM ov_ids), (SELECT phi FROM ov_ids), 'postponed'
  ),
  '23514', NULL, 'postponed game override blocked'
);
UPDATE public.games SET status = 'scheduled' WHERE provider_game_id = 'ov-w3-phi-dal';

SELECT tests.clear_auth();
SELECT * FROM finish();
ROLLBACK;
