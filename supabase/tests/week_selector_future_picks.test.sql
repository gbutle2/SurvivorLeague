-- Future-week picks + week_allows_player_picks privilege/behavior tests.
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

SELECT plan(23);
SELECT tests.clear_auth();

-- Privilege matrix for the new helper
SELECT ok(
  has_function_privilege('authenticated', 'public.week_allows_player_picks(uuid)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.week_allows_player_picks(uuid)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('public', 'public.week_allows_player_picks(uuid)'::regprocedure, 'EXECUTE'),
  'week_allows_player_picks executable by authenticated only'
);

-- Internal chat functions must still be locked down
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.reveal_eligible_pick_events()'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.reveal_eligible_pick_events()'::regprocedure, 'EXECUTE'),
  'reveal_eligible_pick_events remains unavailable to clients'
);

CREATE TEMP TABLE fut_ids (
  p1 UUID, p2 UUID, league UUID, season UUID,
  w1 UUID, w3 UUID, w5 UUID, w_locked UUID,
  team_buf UUID, team_kc UUID, team_bal UUID, team_mia UUID, team_det UUID
);

GRANT SELECT, UPDATE ON fut_ids TO authenticated;
GRANT SELECT ON fut_ids TO anon;

INSERT INTO fut_ids (p1, p2, league, season, w1, w3, w5, w_locked) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaae02',
  'cccccccc-cccc-cccc-cccc-ccccccccce01',
  'dddddddd-dddd-dddd-dddd-ddddddddde01',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee03',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee05',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee99'
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
    ((SELECT p1 FROM fut_ids), 'fut-p1@test.local', '{"display_name":"Fut One"}'::jsonb),
    ((SELECT p2 FROM fut_ids), 'fut-p2@test.local', '{"display_name":"Fut Two"}'::jsonb)
) AS u(id, email, meta);

INSERT INTO public.profiles (id, display_name)
SELECT id, raw_user_meta_data ->> 'display_name' FROM auth.users
WHERE id IN (SELECT p1 FROM fut_ids UNION SELECT p2 FROM fut_ids)
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
VALUES (
  (SELECT league FROM fut_ids), 'Future Picks League', 'future-picks',
  'America/Chicago', (SELECT p2 FROM fut_ids)
);

INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
  ((SELECT league FROM fut_ids), (SELECT p1 FROM fut_ids), 'player', true),
  ((SELECT league FROM fut_ids), (SELECT p2 FROM fut_ids), 'commissioner', true);

INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
VALUES ((SELECT season FROM fut_ids), (SELECT league FROM fut_ids), 2095, 'active', 18);

INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status) VALUES
  ((SELECT w1 FROM fut_ids), (SELECT season FROM fut_ids), 1, 'Week 1', now() + interval '1 day', 'upcoming'),
  ((SELECT w3 FROM fut_ids), (SELECT season FROM fut_ids), 3, 'Week 3', now() + interval '14 days', 'upcoming'),
  ((SELECT w5 FROM fut_ids), (SELECT season FROM fut_ids), 5, 'Week 5', now() + interval '28 days', 'upcoming'),
  ((SELECT w_locked FROM fut_ids), (SELECT season FROM fut_ids), 7, 'Week 7', now() + interval '42 days', 'locked');

UPDATE fut_ids SET
  team_buf = (SELECT id FROM public.teams WHERE abbreviation = 'BUF' LIMIT 1),
  team_kc = (SELECT id FROM public.teams WHERE abbreviation = 'KC' LIMIT 1),
  team_bal = (SELECT id FROM public.teams WHERE abbreviation = 'BAL' LIMIT 1),
  team_mia = (SELECT id FROM public.teams WHERE abbreviation = 'MIA' LIMIT 1),
  team_det = (SELECT id FROM public.teams WHERE abbreviation = 'DET' LIMIT 1);

-- Week 1: Thursday kicked off, Sunday still open
INSERT INTO public.games (
  provider, provider_game_id, season_year, season_type, regular_week_number,
  home_team_id, away_team_id, scheduled_kickoff_at, status
) VALUES
  ('nflverse', 'fut-w1-thu', 2095, 'regular', 1,
   (SELECT team_kc FROM fut_ids), (SELECT team_det FROM fut_ids),
   now() - interval '2 hours', 'in_progress'),
  ('nflverse', 'fut-w1-sun', 2095, 'regular', 1,
   (SELECT team_buf FROM fut_ids), (SELECT team_mia FROM fut_ids),
   now() + interval '2 days', 'scheduled'),
  ('nflverse', 'fut-w3', 2095, 'regular', 3,
   (SELECT team_buf FROM fut_ids), (SELECT team_kc FROM fut_ids),
   now() + interval '14 days', 'scheduled'),
  ('nflverse', 'fut-w5', 2095, 'regular', 5,
   (SELECT team_bal FROM fut_ids), (SELECT team_mia FROM fut_ids),
   now() + interval '28 days', 'scheduled'),
  ('nflverse', 'fut-w7', 2095, 'regular', 7,
   (SELECT team_det FROM fut_ids), (SELECT team_kc FROM fut_ids),
   now() + interval '42 days', 'scheduled');

SELECT ok(
  public.week_allows_player_picks((SELECT w3 FROM fut_ids)),
  'upcoming week with schedule allows player picks'
);
SELECT ok(
  NOT public.week_allows_player_picks((SELECT w_locked FROM fut_ids)),
  'locked week does not allow player picks'
);

SELECT tests.authenticate_as((SELECT p1 FROM fut_ids));

-- Future weeks accept valid picks
SELECT lives_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w3 FROM fut_ids), (SELECT p1 FROM fut_ids), (SELECT team_buf FROM fut_ids)
  ),
  'future week 3 accepts a valid pick'
);

SELECT lives_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w5 FROM fut_ids), (SELECT p1 FROM fut_ids), (SELECT team_bal FROM fut_ids)
  ),
  'future week 5 accepts a second future pick'
);

-- Reuse across future weeks rejected
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w1 FROM fut_ids), (SELECT p1 FROM fut_ids), (SELECT team_buf FROM fut_ids)
  ),
  '23514', NULL, 'team reuse across future weeks is rejected'
);

-- Change future pick releases old team
SELECT lives_ok(
  format(
    'UPDATE public.picks SET team_id = %L WHERE week_id = %L AND user_id = %L',
    (SELECT team_kc FROM fut_ids), (SELECT w3 FROM fut_ids), (SELECT p1 FROM fut_ids)
  ),
  'changing future week 3 pick before kickoff succeeds'
);

SELECT lives_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w1 FROM fut_ids), (SELECT p1 FROM fut_ids), (SELECT team_buf FROM fut_ids)
  ),
  'released team becomes available in another week'
);

-- Started team cannot be newly selected; unstarted Sunday still OK after Thu began
SELECT throws_ok(
  format(
    'UPDATE public.picks SET team_id = %L WHERE week_id = %L AND user_id = %L',
    (SELECT team_det FROM fut_ids), (SELECT w1 FROM fut_ids), (SELECT p1 FROM fut_ids)
  ),
  '42501', NULL, 'cannot switch week 1 pick to kicked-off Thursday team'
);

SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w1 FROM fut_ids), (SELECT p1 FROM fut_ids), (SELECT team_kc FROM fut_ids)
  ),
  NULL, NULL, 'owner cannot insert a second week-1 pick'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT p2 FROM fut_ids));
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w1 FROM fut_ids), (SELECT p2 FROM fut_ids), (SELECT team_kc FROM fut_ids)
  ),
  '42501', NULL, 'new pick cannot select a started team'
);

SELECT lives_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w1 FROM fut_ids), (SELECT p2 FROM fut_ids), (SELECT team_mia FROM fut_ids)
  ),
  'member with no pick may select an unstarted Sunday game after Thursday began'
);

-- Locked administrative week rejects picks even with future kickoff
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w_locked FROM fut_ids), (SELECT p1 FROM fut_ids), (SELECT team_det FROM fut_ids)
  ),
  '42501', NULL, 'locked week rejects player picks'
);

-- Peer cannot see unrevealed future team
SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT p2 FROM fut_ids));
SELECT is(
  (
    SELECT count(*)::int FROM public.picks
    WHERE week_id = (SELECT w5 FROM fut_ids)
      AND user_id = (SELECT p1 FROM fut_ids)
  ),
  0,
  'peer cannot read unrevealed future pick team row'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT p1 FROM fut_ids));
SELECT is(
  (
    SELECT team_id FROM public.picks
    WHERE week_id = (SELECT w5 FROM fut_ids) AND user_id = (SELECT p1 FROM fut_ids)
  ),
  (SELECT team_bal FROM fut_ids),
  'owner can read own future pick'
);

-- Privacy-safe chat events for future submission
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.league_events e
    WHERE e.event_type = 'pick_submitted'
      AND e.affected_user_id = (SELECT p1 FROM fut_ids)
      AND e.domain_record_id = (
        SELECT id FROM public.picks
        WHERE week_id = (SELECT w5 FROM fut_ids) AND user_id = (SELECT p1 FROM fut_ids)
      )
      AND e.is_revealed = false
      AND NOT (e.payload ? 'team_id')
  ),
  'future pick creates privacy-safe chat event'
);

SELECT is(
  (
    SELECT count(*)::int FROM public.league_events e
    WHERE e.event_type = 'pick_submitted'
      AND e.affected_user_id = (SELECT p1 FROM fut_ids)
      AND e.domain_record_id = (
        SELECT id FROM public.picks
        WHERE week_id = (SELECT w5 FROM fut_ids) AND user_id = (SELECT p1 FROM fut_ids)
      )
  ),
  1,
  'idempotent domain write does not duplicate pick_submitted events'
);

-- Lock existing pick at kickoff, cannot move to later game
SELECT tests.clear_auth();
UPDATE public.games
SET scheduled_kickoff_at = now() - interval '1 minute', status = 'in_progress'
WHERE provider_game_id = 'fut-w5';

SELECT tests.authenticate_as((SELECT p1 FROM fut_ids));
UPDATE public.picks
SET team_id = (SELECT team_mia FROM fut_ids)
WHERE week_id = (SELECT w5 FROM fut_ids) AND user_id = (SELECT p1 FROM fut_ids);
SELECT is(
  (
    SELECT team_id FROM public.picks
    WHERE week_id = (SELECT w5 FROM fut_ids) AND user_id = (SELECT p1 FROM fut_ids)
  ),
  (SELECT team_bal FROM fut_ids),
  'cannot change pick after selected team kickoff'
);

-- Concurrent reuse across two future weeks (serial simulation under advisory lock)
SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT p2 FROM fut_ids));
SELECT lives_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w3 FROM fut_ids), (SELECT p2 FROM fut_ids), (SELECT team_buf FROM fut_ids)
  ),
  'p2 can reserve BUF in week 3'
);
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w5 FROM fut_ids), (SELECT p2 FROM fut_ids), (SELECT team_buf FROM fut_ids)
  ),
  '23514', NULL, 'same team rejected in a second future week'
);

SELECT tests.set_anon();
SELECT throws_ok(
  format(
    'INSERT INTO public.picks (week_id, user_id, team_id) VALUES (%L, %L, %L)',
    (SELECT w3 FROM fut_ids), (SELECT p1 FROM fut_ids), (SELECT team_det FROM fut_ids)
  ),
  NULL, NULL, 'anon cannot insert picks'
);

SELECT tests.clear_auth();

-- Upgrade-path smoke: existing-shaped pick rows still readable
SELECT is(
  (SELECT count(*)::int FROM public.picks WHERE user_id IN (SELECT p1 FROM fut_ids UNION SELECT p2 FROM fut_ids)),
  5,
  'fixture picks remain after future-week writes'
);

SELECT * FROM finish();
ROLLBACK;
