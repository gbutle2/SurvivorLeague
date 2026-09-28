-- Commissioner editing their own pre-kickoff pick after an override must work
-- like any other owner: change succeeds and clears override provenance.
-- Started games remain owner-locked (commissioner RPC only).
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

SELECT plan(14);
SELECT tests.clear_auth();

CREATE TEMP TABLE own_ids (
  player UUID, commish UUID, league UUID, season UUID, week UUID,
  team_buf UUID, team_det UUID, team_phi UUID, team_kc UUID,
  game_future UUID, game_started UUID
);

GRANT SELECT, UPDATE ON own_ids TO authenticated;

INSERT INTO own_ids (player, commish, league, season, week) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaab02',
  'cccccccc-cccc-cccc-cccc-cccccccccb01',
  'dddddddd-dddd-dddd-dddd-dddddddddb01',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeb01'
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
    ((SELECT player FROM own_ids), 'own-p@test.local', '{"display_name":"Own Player"}'::jsonb),
    ((SELECT commish FROM own_ids), 'own-c@test.local', '{"display_name":"Own Commish"}'::jsonb)
) AS u(id, email, meta);

INSERT INTO public.profiles (id, display_name)
SELECT id, raw_user_meta_data ->> 'display_name' FROM auth.users
WHERE id IN (SELECT player FROM own_ids UNION SELECT commish FROM own_ids)
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
VALUES (
  (SELECT league FROM own_ids), 'Own Pick League', 'own-pick-rules',
  'America/Chicago', (SELECT commish FROM own_ids)
);

INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
  ((SELECT league FROM own_ids), (SELECT player FROM own_ids), 'player', true),
  ((SELECT league FROM own_ids), (SELECT commish FROM own_ids), 'commissioner', true);

INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
VALUES ((SELECT season FROM own_ids), (SELECT league FROM own_ids), 2098, 'active', 18);

INSERT INTO public.scoring_rules (season_id) VALUES ((SELECT season FROM own_ids));

INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status)
VALUES (
  (SELECT week FROM own_ids), (SELECT season FROM own_ids), 5, 'Week 5',
  now() + interval '14 days', 'upcoming'
);

UPDATE own_ids SET
  team_buf = (SELECT id FROM public.teams WHERE abbreviation = 'BUF' LIMIT 1),
  team_det = (SELECT id FROM public.teams WHERE abbreviation = 'DET' LIMIT 1),
  team_phi = (SELECT id FROM public.teams WHERE abbreviation = 'PHI' LIMIT 1),
  team_kc = (SELECT id FROM public.teams WHERE abbreviation = 'KC' LIMIT 1);

INSERT INTO public.games (
  provider, provider_game_id, season_year, season_type, regular_week_number,
  home_team_id, away_team_id, scheduled_kickoff_at, status
) VALUES
  ('nflverse', 'own-w5-future', 2098, 'regular', 5,
   (SELECT team_buf FROM own_ids), (SELECT team_kc FROM own_ids),
   now() + interval '3 days', 'scheduled'),
  ('nflverse', 'own-w5-started', 2098, 'regular', 5,
   (SELECT team_det FROM own_ids), (SELECT team_phi FROM own_ids),
   now() - interval '1 hour', 'in_progress');

UPDATE own_ids SET
  game_future = (
    SELECT id FROM public.games
    WHERE provider_game_id = 'own-w5-future' AND season_year = 2098
  ),
  game_started = (
    SELECT id FROM public.games
    WHERE provider_game_id = 'own-w5-started' AND season_year = 2098
  );

-- Commissioner overrides their own future pick
SELECT tests.authenticate_as((SELECT commish FROM own_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT commish FROM own_ids),
      (SELECT week FROM own_ids),
      (SELECT team_buf FROM own_ids),
      'Self override future'
    )->>'result') = 'pending'
  ),
  'commissioner can override their own future pick'
);

SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week FROM own_ids))
    WHERE user_id = (SELECT commish FROM own_ids)
  ),
  true,
  'self-override stamps currently_commissioner_overridden'
);

-- Owner (commissioner) changes own unlocked pick via normal player UPDATE
SELECT lives_ok(
  format(
    'UPDATE public.picks SET team_id = %L WHERE week_id = %L AND user_id = %L',
    (SELECT team_kc FROM own_ids),
    (SELECT week FROM own_ids),
    (SELECT commish FROM own_ids)
  ),
  'commissioner can change own pre-kickoff pick after override'
);

SELECT tests.clear_auth();
SELECT ok(
  (
    SELECT last_commissioner_override_audit_id IS NULL FROM public.picks
    WHERE user_id = (SELECT commish FROM own_ids)
      AND week_id = (SELECT week FROM own_ids)
  ),
  'commissioner own change clears override stamp'
);

SELECT tests.authenticate_as((SELECT commish FROM own_ids));
SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week FROM own_ids))
    WHERE user_id = (SELECT commish FROM own_ids)
  ),
  false,
  'override designation clears after commissioner own change'
);

-- Regular player after override can still change (regression)
SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT commish FROM own_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM own_ids),
      (SELECT week FROM own_ids),
      (SELECT team_buf FROM own_ids),
      'Override player future'
    )->>'result') = 'pending'
  ),
  'commissioner overrides another player future pick'
);

SELECT tests.authenticate_as((SELECT player FROM own_ids));
SELECT lives_ok(
  format(
    'UPDATE public.picks SET team_id = %L WHERE week_id = %L AND user_id = %L',
    (SELECT team_kc FROM own_ids),
    (SELECT week FROM own_ids),
    (SELECT player FROM own_ids)
  ),
  'player can change own pre-kickoff overridden pick'
);

SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week FROM own_ids))
    WHERE user_id = (SELECT player FROM own_ids)
  ),
  false,
  'player change clears override designation'
);

-- Started game: owner cannot change; commissioner RPC can
SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT commish FROM own_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM own_ids),
      (SELECT week FROM own_ids),
      (SELECT team_det FROM own_ids),
      'Override to started game'
    )->>'result') = 'pending'
  ),
  'commissioner can override onto an in-progress game'
);

SELECT tests.authenticate_as((SELECT player FROM own_ids));
-- RLS USING fails quietly (0 rows) when the current pick's game has started.
UPDATE public.picks
SET team_id = (SELECT team_buf FROM own_ids)
WHERE week_id = (SELECT week FROM own_ids) AND user_id = (SELECT player FROM own_ids);
SELECT is(
  (
    SELECT team_id FROM public.picks
    WHERE week_id = (SELECT week FROM own_ids) AND user_id = (SELECT player FROM own_ids)
  ),
  (SELECT team_det FROM own_ids),
  'player cannot change pick after selected game has started'
);

SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT commish FROM own_ids));
SELECT lives_ok(
  format(
    'SELECT public.commissioner_override_pick(%L, %L, %L, %L)',
    (SELECT player FROM own_ids),
    (SELECT week FROM own_ids),
    (SELECT team_phi FROM own_ids),
    'Commissioner changes started-game pick'
  ),
  'commissioner RPC can still change a started-game pick'
);

SELECT tests.clear_auth();
SELECT ok(
  (
    SELECT last_commissioner_override_audit_id IS NOT NULL FROM public.picks
    WHERE user_id = (SELECT player FROM own_ids)
      AND week_id = (SELECT week FROM own_ids)
  ),
  'started-game commissioner change keeps override stamp'
);

-- Commissioner own pick on a started game is also owner-locked
SELECT tests.authenticate_as((SELECT commish FROM own_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT commish FROM own_ids),
      (SELECT week FROM own_ids),
      (SELECT team_det FROM own_ids),
      'Self override onto started game'
    )->>'result') = 'pending'
  ),
  'commissioner can override own pick onto started game'
);

UPDATE public.picks
SET team_id = (SELECT team_buf FROM own_ids)
WHERE week_id = (SELECT week FROM own_ids) AND user_id = (SELECT commish FROM own_ids);
SELECT is(
  (
    SELECT team_id FROM public.picks
    WHERE week_id = (SELECT week FROM own_ids) AND user_id = (SELECT commish FROM own_ids)
  ),
  (SELECT team_det FROM own_ids),
  'commissioner cannot change own pick via player path after kickoff'
);

SELECT * FROM finish();
ROLLBACK;
