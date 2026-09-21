-- week_pick_submission_status: privacy, privileges, has_pick, commissioner override flag.
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

CREATE OR REPLACE FUNCTION tests.set_anon()
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, tests
AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
  EXECUTE 'SET ROLE anon';
END;
$$;

GRANT USAGE ON SCHEMA tests TO authenticated;
GRANT USAGE ON SCHEMA tests TO anon;
GRANT EXECUTE ON FUNCTION tests.authenticate_as(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION tests.clear_auth() TO authenticated;
GRANT EXECUTE ON FUNCTION tests.clear_auth() TO anon;
GRANT EXECUTE ON FUNCTION tests.set_anon() TO authenticated;
GRANT EXECUTE ON FUNCTION tests.set_anon() TO anon;

SELECT plan(24);
SELECT tests.clear_auth();

-- Privilege matrix
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.week_pick_submission_status(uuid)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.week_pick_submission_status(uuid)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'public',
    'public.week_pick_submission_status(uuid)'::regprocedure,
    'EXECUTE'
  ),
  'week_pick_submission_status executable by authenticated only'
);

-- Chat lockdown regression
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.reveal_eligible_pick_events()'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.reveal_eligible_pick_events()'::regprocedure,
    'EXECUTE'
  ),
  'reveal_eligible_pick_events remains unavailable to clients'
);

CREATE TEMP TABLE sub_ids (
  p1 UUID, p2 UUID, p3 UUID, outsider UUID, other_league_member UUID,
  league_a UUID, league_b UUID, season_a UUID, season_b UUID,
  week_a UUID, week_b UUID,
  team_kc UUID, team_buf UUID, team_det UUID, team_mia UUID, team_phi UUID, team_sf UUID,
  game_future UUID, game_future_b UUID
);

GRANT SELECT, UPDATE ON sub_ids TO authenticated;
GRANT SELECT ON sub_ids TO anon;

INSERT INTO sub_ids (
  p1, p2, p3, outsider, other_league_member,
  league_a, league_b, season_a, season_b, week_a, week_b
) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaf01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaf02',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaf03',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaf04',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaf05',
  'cccccccc-cccc-cccc-cccc-cccccccccf01',
  'cccccccc-cccc-cccc-cccc-cccccccccf02',
  'dddddddd-dddd-dddd-dddd-dddddddddf01',
  'dddddddd-dddd-dddd-dddd-dddddddddf02',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeef01',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeef02'
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
    ((SELECT p1 FROM sub_ids), 'sub-p1@test.local', '{"display_name":"Sub One"}'::jsonb),
    ((SELECT p2 FROM sub_ids), 'sub-p2@test.local', '{"display_name":"Sub Two"}'::jsonb),
    ((SELECT p3 FROM sub_ids), 'sub-p3@test.local', '{"display_name":"Sub Three"}'::jsonb),
    ((SELECT outsider FROM sub_ids), 'sub-out@test.local', '{"display_name":"Outsider"}'::jsonb),
    ((SELECT other_league_member FROM sub_ids), 'sub-other@test.local', '{"display_name":"Other Lg"}'::jsonb)
) AS u(id, email, meta);

INSERT INTO public.profiles (id, display_name)
SELECT id, raw_user_meta_data ->> 'display_name' FROM auth.users
WHERE id IN (
  SELECT p1 FROM sub_ids UNION SELECT p2 FROM sub_ids UNION SELECT p3 FROM sub_ids
  UNION SELECT outsider FROM sub_ids UNION SELECT other_league_member FROM sub_ids
)
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id) VALUES
  ((SELECT league_a FROM sub_ids), 'Submission Status A', 'sub-status-a',
   'America/Chicago', (SELECT p2 FROM sub_ids)),
  ((SELECT league_b FROM sub_ids), 'Submission Status B', 'sub-status-b',
   'America/Chicago', (SELECT other_league_member FROM sub_ids));

INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
  ((SELECT league_a FROM sub_ids), (SELECT p1 FROM sub_ids), 'player', true),
  ((SELECT league_a FROM sub_ids), (SELECT p2 FROM sub_ids), 'commissioner', true),
  ((SELECT league_a FROM sub_ids), (SELECT p3 FROM sub_ids), 'player', true),
  ((SELECT league_b FROM sub_ids), (SELECT other_league_member FROM sub_ids), 'commissioner', true);

INSERT INTO public.seasons (id, league_id, year, status, regular_week_count) VALUES
  ((SELECT season_a FROM sub_ids), (SELECT league_a FROM sub_ids), 2096, 'active', 18),
  ((SELECT season_b FROM sub_ids), (SELECT league_b FROM sub_ids), 2096, 'active', 18);

INSERT INTO public.scoring_rules (season_id) VALUES
  ((SELECT season_a FROM sub_ids)),
  ((SELECT season_b FROM sub_ids));

INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status) VALUES
  ((SELECT week_a FROM sub_ids), (SELECT season_a FROM sub_ids), 3, 'Week 3',
   now() + interval '14 days', 'upcoming'),
  ((SELECT week_b FROM sub_ids), (SELECT season_b FROM sub_ids), 3, 'Week 3',
   now() + interval '14 days', 'upcoming');

UPDATE sub_ids SET
  team_kc = (SELECT id FROM public.teams WHERE abbreviation = 'KC' LIMIT 1),
  team_buf = (SELECT id FROM public.teams WHERE abbreviation = 'BUF' LIMIT 1),
  team_det = (SELECT id FROM public.teams WHERE abbreviation = 'DET' LIMIT 1),
  team_mia = (SELECT id FROM public.teams WHERE abbreviation = 'MIA' LIMIT 1),
  team_phi = (SELECT id FROM public.teams WHERE abbreviation = 'PHI' LIMIT 1),
  team_sf = (SELECT id FROM public.teams WHERE abbreviation = 'SF' LIMIT 1);

INSERT INTO public.games (
  provider, provider_game_id, season_year, season_type, regular_week_number,
  home_team_id, away_team_id, scheduled_kickoff_at, status
) VALUES
  ('nflverse', 'sub-w3-a', 2096, 'regular', 3,
   (SELECT team_kc FROM sub_ids), (SELECT team_buf FROM sub_ids),
   now() + interval '3 days', 'scheduled'),
  ('nflverse', 'sub-w3-b', 2096, 'regular', 3,
   (SELECT team_det FROM sub_ids), (SELECT team_mia FROM sub_ids),
   now() + interval '4 days', 'scheduled'),
  ('nflverse', 'sub-w3-c', 2096, 'regular', 3,
   (SELECT team_phi FROM sub_ids), (SELECT team_sf FROM sub_ids),
   now() + interval '5 days', 'scheduled');

-- Same week number games for league B season year collide on provider uniqueness
-- by season_year; reuse same games for week_b schedule needs (season 2096 week 3).

UPDATE sub_ids SET
  game_future = (
    SELECT id FROM public.games
    WHERE provider_game_id = 'sub-w3-a' AND season_year = 2096
  ),
  game_future_b = (
    SELECT id FROM public.games
    WHERE provider_game_id = 'sub-w3-b' AND season_year = 2096
  );

-- p1 submits a future (hidden) pick; p3 has no pick
SELECT tests.authenticate_as((SELECT p1 FROM sub_ids));
INSERT INTO public.picks (week_id, user_id, team_id)
VALUES (
  (SELECT week_a FROM sub_ids),
  (SELECT p1 FROM sub_ids),
  (SELECT team_kc FROM sub_ids)
);
SELECT tests.clear_auth();

-- Peer cannot see p1's pick via RLS
SELECT tests.authenticate_as((SELECT p2 FROM sub_ids));
SELECT is(
  (
    SELECT count(*)::int FROM public.picks
    WHERE week_id = (SELECT week_a FROM sub_ids)
      AND user_id = (SELECT p1 FROM sub_ids)
  ),
  0,
  'peer RLS hides unrevealed pick row'
);

-- Member can retrieve submission status for their league
SELECT results_eq(
  $$
    SELECT user_id, has_pick, currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week_a FROM sub_ids))
    ORDER BY user_id
  $$,
  $$
    VALUES
      ((SELECT p1 FROM sub_ids), true, false),
      ((SELECT p2 FROM sub_ids), false, false),
      ((SELECT p3 FROM sub_ids), false, false)
  $$,
  'active members get has_pick without override by default'
);

-- Payload keys: no team/game/pick/sensitive fields
SELECT ok(
  (
    SELECT bool_and(
      to_jsonb(r) ? 'user_id'
      AND to_jsonb(r) ? 'has_pick'
      AND to_jsonb(r) ? 'currently_commissioner_overridden'
      AND NOT (to_jsonb(r) ? 'team_id')
      AND NOT (to_jsonb(r) ? 'game_id')
      AND NOT (to_jsonb(r) ? 'pick_id')
      AND NOT (to_jsonb(r) ? 'id')
      AND NOT (to_jsonb(r) ? 'reason')
      AND NOT (to_jsonb(r) ? 'new_team_id')
      AND NOT (to_jsonb(r) ? 'previous_team_id')
    )
    FROM public.week_pick_submission_status((SELECT week_a FROM sub_ids)) r
  ),
  'status rows expose only user_id/has_pick/override boolean'
);

-- Hidden submitted pick reports has_pick true only
SELECT is(
  (
    SELECT has_pick FROM public.week_pick_submission_status((SELECT week_a FROM sub_ids))
    WHERE user_id = (SELECT p1 FROM sub_ids)
  ),
  true,
  'submitted hidden pick reports has_pick = true'
);

SELECT is(
  (
    SELECT has_pick FROM public.week_pick_submission_status((SELECT week_a FROM sub_ids))
    WHERE user_id = (SELECT p3 FROM sub_ids)
  ),
  false,
  'member with no pick reports has_pick = false'
);

-- Nonmember / other league / anonymous denied
SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT outsider FROM sub_ids));
SELECT throws_ok(
  format(
    'SELECT * FROM public.week_pick_submission_status(%L)',
    (SELECT week_a FROM sub_ids)
  ),
  '42501', NULL, 'nonmember cannot obtain submission status'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT other_league_member FROM sub_ids));
SELECT throws_ok(
  format(
    'SELECT * FROM public.week_pick_submission_status(%L)',
    (SELECT week_a FROM sub_ids)
  ),
  '42501', NULL, 'other-league member cannot obtain status'
);

SELECT tests.clear_auth();
SELECT tests.set_anon();
SELECT throws_ok(
  format(
    'SELECT * FROM public.week_pick_submission_status(%L)',
    (SELECT week_a FROM sub_ids)
  ),
  '42501', NULL, 'anonymous caller cannot obtain status'
);
SELECT tests.clear_auth();

-- ---------------------------------------------------------------------------
-- Commissioner override provenance (current pick, not result_source)
-- ---------------------------------------------------------------------------

SELECT tests.authenticate_as((SELECT p2 FROM sub_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT p3 FROM sub_ids),
      (SELECT week_a FROM sub_ids),
      (SELECT team_buf FROM sub_ids),
      'Initial commissioner set'
    )->>'result') = 'pending'
  ),
  'commissioner can create pick for p3'
);

SELECT tests.clear_auth();
SELECT is(
  (
    SELECT result_source::text FROM public.picks
    WHERE user_id = (SELECT p3 FROM sub_ids)
      AND week_id = (SELECT week_a FROM sub_ids)
  ),
  'auto',
  'override still stores result_source = auto'
);

SELECT tests.authenticate_as((SELECT p2 FROM sub_ids));
SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week_a FROM sub_ids))
    WHERE user_id = (SELECT p3 FROM sub_ids)
  ),
  true,
  'current commissioner-overridden pick is flagged'
);

-- Second override updates to latest team
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT p3 FROM sub_ids),
      (SELECT week_a FROM sub_ids),
      (SELECT team_det FROM sub_ids),
      'Second commissioner set'
    )->>'result') = 'pending'
  ),
  'second commissioner override accepted'
);

SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week_a FROM sub_ids))
    WHERE user_id = (SELECT p3 FROM sub_ids)
  ),
  true,
  'latest override still flags current pick'
);

SELECT tests.clear_auth();
SELECT is(
  (
    SELECT team_id FROM public.picks
    WHERE user_id = (SELECT p3 FROM sub_ids)
      AND week_id = (SELECT week_a FROM sub_ids)
  ),
  (SELECT team_det FROM sub_ids),
  'latest override team is current pick'
);

-- Player legally changes after override → clears indicator
SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT p3 FROM sub_ids));
SELECT lives_ok(
  format(
    'UPDATE public.picks SET team_id = %L WHERE week_id = %L AND user_id = %L',
    (SELECT team_phi FROM sub_ids),
    (SELECT week_a FROM sub_ids),
    (SELECT p3 FROM sub_ids)
  ),
  'player can change pick after override before kickoff'
);

SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week_a FROM sub_ids))
    WHERE user_id = (SELECT p3 FROM sub_ids)
  ),
  false,
  'player mutation clears commissioner override indicator'
);

-- No audit entry → false
SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week_a FROM sub_ids))
    WHERE user_id = (SELECT p1 FROM sub_ids)
  ),
  false,
  'no audit entry means not commissioner-overridden'
);

-- Hidden pick: override flag without leaking team via status API
SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT p2 FROM sub_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT p1 FROM sub_ids),
      (SELECT week_a FROM sub_ids),
      (SELECT team_mia FROM sub_ids),
      'Override hidden pick'
    )->>'result') IS NOT NULL
  ),
  'commissioner can override existing p1 pick'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT p3 FROM sub_ids));
SELECT ok(
  (
    SELECT currently_commissioner_overridden AND has_pick
    FROM public.week_pick_submission_status((SELECT week_a FROM sub_ids))
    WHERE user_id = (SELECT p1 FROM sub_ids)
  ),
  'peer sees override flag for hidden pick'
);

SELECT is(
  (
    SELECT count(*)::int FROM public.picks
    WHERE week_id = (SELECT week_a FROM sub_ids)
      AND user_id = (SELECT p1 FROM sub_ids)
  ),
  0,
  'peer still cannot read hidden pick row after override'
);

SELECT ok(
  (
    SELECT bool_and(
      NOT (to_jsonb(r) ? 'team_id')
      AND NOT (to_jsonb(r) ? 'game_id')
      AND NOT (to_jsonb(r) ? 'new_team_id')
    )
    FROM public.week_pick_submission_status((SELECT week_a FROM sub_ids)) r
    WHERE r.user_id = (SELECT p1 FROM sub_ids)
  ),
  'override-status API does not leak hidden team identity'
);

-- week_allows_player_picks privilege matrix still intact
SELECT ok(
  has_function_privilege(
    'authenticated',
    'public.week_allows_player_picks(uuid)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'anon',
    'public.week_allows_player_picks(uuid)'::regprocedure,
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'public',
    'public.week_allows_player_picks(uuid)'::regprocedure,
    'EXECUTE'
  ),
  'week_allows_player_picks privilege matrix unchanged'
);

SELECT * FROM finish();
ROLLBACK;
