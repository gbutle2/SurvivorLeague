-- Provenance stamp clears on any team_id/game_id change (including null auth.uid()).
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

SELECT plan(23);
SELECT tests.clear_auth();

-- Privilege regression
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
  'week_pick_submission_status EXECUTE remains authenticated-only'
);

CREATE TEMP TABLE stamp_ids (
  player UUID, commish UUID, league UUID, season UUID, week UUID,
  team_buf UUID, team_det UUID, team_phi UUID, team_kc UUID,
  game_buf UUID, game_det UUID, game_phi UUID, game_kc UUID,
  first_audit UUID, second_audit UUID
);

GRANT SELECT, UPDATE ON stamp_ids TO authenticated;

INSERT INTO stamp_ids (player, commish, league, season, week) VALUES (
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02',
  'cccccccc-cccc-cccc-cccc-cccccccccc01',
  'dddddddd-dddd-dddd-dddd-dddddddddd01',
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'
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
    ((SELECT player FROM stamp_ids), 'stamp-p@test.local', '{"display_name":"Stamp Player"}'::jsonb),
    ((SELECT commish FROM stamp_ids), 'stamp-c@test.local', '{"display_name":"Stamp Commish"}'::jsonb)
) AS u(id, email, meta);

INSERT INTO public.profiles (id, display_name)
SELECT id, raw_user_meta_data ->> 'display_name' FROM auth.users
WHERE id IN (SELECT player FROM stamp_ids UNION SELECT commish FROM stamp_ids)
ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
VALUES (
  (SELECT league FROM stamp_ids), 'Stamp Clear League', 'stamp-clear',
  'America/Chicago', (SELECT commish FROM stamp_ids)
);

INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
  ((SELECT league FROM stamp_ids), (SELECT player FROM stamp_ids), 'player', true),
  ((SELECT league FROM stamp_ids), (SELECT commish FROM stamp_ids), 'commissioner', true);

INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
VALUES ((SELECT season FROM stamp_ids), (SELECT league FROM stamp_ids), 2097, 'active', 18);

INSERT INTO public.scoring_rules (season_id) VALUES ((SELECT season FROM stamp_ids));

INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status)
VALUES (
  (SELECT week FROM stamp_ids), (SELECT season FROM stamp_ids), 4, 'Week 4',
  now() + interval '14 days', 'upcoming'
);

UPDATE stamp_ids SET
  team_buf = (SELECT id FROM public.teams WHERE abbreviation = 'BUF' LIMIT 1),
  team_det = (SELECT id FROM public.teams WHERE abbreviation = 'DET' LIMIT 1),
  team_phi = (SELECT id FROM public.teams WHERE abbreviation = 'PHI' LIMIT 1),
  team_kc = (SELECT id FROM public.teams WHERE abbreviation = 'KC' LIMIT 1);

INSERT INTO public.games (
  provider, provider_game_id, season_year, season_type, regular_week_number,
  home_team_id, away_team_id, scheduled_kickoff_at, status
) VALUES
  ('nflverse', 'stamp-w4-a', 2097, 'regular', 4,
   (SELECT team_buf FROM stamp_ids), (SELECT team_kc FROM stamp_ids),
   now() + interval '3 days', 'scheduled'),
  ('nflverse', 'stamp-w4-b', 2097, 'regular', 4,
   (SELECT team_det FROM stamp_ids), (SELECT team_phi FROM stamp_ids),
   now() + interval '4 days', 'scheduled');

UPDATE stamp_ids SET
  game_buf = (
    SELECT id FROM public.games
    WHERE provider_game_id = 'stamp-w4-a' AND season_year = 2097
  ),
  game_kc = (
    SELECT id FROM public.games
    WHERE provider_game_id = 'stamp-w4-a' AND season_year = 2097
  ),
  game_det = (
    SELECT id FROM public.games
    WHERE provider_game_id = 'stamp-w4-b' AND season_year = 2097
  ),
  game_phi = (
    SELECT id FROM public.games
    WHERE provider_game_id = 'stamp-w4-b' AND season_year = 2097
  );

-- 6) Commissioner override installs stamp
SELECT tests.authenticate_as((SELECT commish FROM stamp_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM stamp_ids),
      (SELECT week FROM stamp_ids),
      (SELECT team_buf FROM stamp_ids),
      'Install stamp'
    )->>'result') = 'pending'
  ),
  'commissioner override installs pick'
);

SELECT tests.clear_auth();
UPDATE stamp_ids SET first_audit = (
  SELECT last_commissioner_override_audit_id FROM public.picks
  WHERE user_id = (SELECT player FROM stamp_ids)
    AND week_id = (SELECT week FROM stamp_ids)
);

SELECT ok(
  (SELECT first_audit IS NOT NULL FROM stamp_ids),
  'commissioner override stamps last_commissioner_override_audit_id'
);

SELECT tests.authenticate_as((SELECT player FROM stamp_ids));
SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week FROM stamp_ids))
    WHERE user_id = (SELECT player FROM stamp_ids)
  ),
  true,
  'status flag true after commissioner stamp'
);

-- 1) Player team change clears stamp
SELECT lives_ok(
  format(
    'UPDATE public.picks SET team_id = %L WHERE week_id = %L AND user_id = %L',
    (SELECT team_det FROM stamp_ids),
    (SELECT week FROM stamp_ids),
    (SELECT player FROM stamp_ids)
  ),
  'player team change succeeds'
);

SELECT tests.clear_auth();
SELECT ok(
  (
    SELECT last_commissioner_override_audit_id IS NULL FROM public.picks
    WHERE user_id = (SELECT player FROM stamp_ids)
      AND week_id = (SELECT week FROM stamp_ids)
  ),
  'player team change clears the stamp'
);

SELECT tests.authenticate_as((SELECT player FROM stamp_ids));
SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week FROM stamp_ids))
    WHERE user_id = (SELECT player FROM stamp_ids)
  ),
  false,
  'status flag false after player team change'
);

-- Re-install stamp for service-path tests
SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT commish FROM stamp_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM stamp_ids),
      (SELECT week FROM stamp_ids),
      (SELECT team_buf FROM stamp_ids),
      'Re-install for service tests'
    )->>'audit_id') IS NOT NULL
  ),
  'commissioner re-override installs a new stamp'
);

SELECT tests.clear_auth();
UPDATE stamp_ids SET first_audit = (
  SELECT last_commissioner_override_audit_id FROM public.picks
  WHERE user_id = (SELECT player FROM stamp_ids)
    AND week_id = (SELECT week FROM stamp_ids)
);

SELECT tests.authenticate_as((SELECT player FROM stamp_ids));
SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week FROM stamp_ids))
    WHERE user_id = (SELECT player FROM stamp_ids)
  ),
  true,
  'status flag true after re-override'
);

-- 2) Null-auth team change clears stamp
SELECT tests.clear_auth();
UPDATE public.picks
SET team_id = (SELECT team_det FROM stamp_ids),
    game_id = (SELECT game_det FROM stamp_ids)
WHERE user_id = (SELECT player FROM stamp_ids)
  AND week_id = (SELECT week FROM stamp_ids);

SELECT ok(
  (
    SELECT last_commissioner_override_audit_id IS NULL FROM public.picks
    WHERE user_id = (SELECT player FROM stamp_ids)
      AND week_id = (SELECT week FROM stamp_ids)
  ),
  'null-auth team change clears the stamp'
);

SELECT tests.authenticate_as((SELECT player FROM stamp_ids));
SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week FROM stamp_ids))
    WHERE user_id = (SELECT player FROM stamp_ids)
  ),
  false,
  'status flag false after null-auth team change'
);

-- Re-stamp, then 3) null-auth game_id change clears stamp
SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT commish FROM stamp_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM stamp_ids),
      (SELECT week FROM stamp_ids),
      (SELECT team_phi FROM stamp_ids),
      'Stamp before game change'
    )->>'audit_id') IS NOT NULL
  ),
  'override before null-auth game change'
);
SELECT tests.clear_auth();

UPDATE public.picks
SET game_id = (SELECT game_buf FROM stamp_ids),
    team_id = (SELECT team_kc FROM stamp_ids)
WHERE user_id = (SELECT player FROM stamp_ids)
  AND week_id = (SELECT week FROM stamp_ids);

SELECT ok(
  (
    SELECT last_commissioner_override_audit_id IS NULL
       AND game_id = (SELECT game_buf FROM stamp_ids)
    FROM public.picks
    WHERE user_id = (SELECT player FROM stamp_ids)
      AND week_id = (SELECT week FROM stamp_ids)
  ),
  'null-auth game_id change clears the stamp'
);

-- 4) Changing away then back never restores the old stamp
SELECT tests.authenticate_as((SELECT commish FROM stamp_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM stamp_ids),
      (SELECT week FROM stamp_ids),
      (SELECT team_buf FROM stamp_ids),
      'Stamp for away-and-back'
    )->>'audit_id') IS NOT NULL
  ),
  'override before away-and-back'
);
SELECT tests.clear_auth();
UPDATE stamp_ids SET first_audit = (
  SELECT last_commissioner_override_audit_id FROM public.picks
  WHERE user_id = (SELECT player FROM stamp_ids)
    AND week_id = (SELECT week FROM stamp_ids)
);

UPDATE public.picks
SET team_id = (SELECT team_det FROM stamp_ids),
    game_id = (SELECT game_det FROM stamp_ids)
WHERE user_id = (SELECT player FROM stamp_ids)
  AND week_id = (SELECT week FROM stamp_ids);

UPDATE public.picks
SET team_id = (SELECT team_buf FROM stamp_ids),
    game_id = (SELECT game_buf FROM stamp_ids)
WHERE user_id = (SELECT player FROM stamp_ids)
  AND week_id = (SELECT week FROM stamp_ids);

SELECT ok(
  (
    SELECT last_commissioner_override_audit_id IS NULL
       AND team_id = (SELECT team_buf FROM stamp_ids)
    FROM public.picks
    WHERE user_id = (SELECT player FROM stamp_ids)
      AND week_id = (SELECT week FROM stamp_ids)
  ),
  'changing away and back never restores the old stamp'
);

SELECT tests.authenticate_as((SELECT player FROM stamp_ids));
SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week FROM stamp_ids))
    WHERE user_id = (SELECT player FROM stamp_ids)
  ),
  false,
  'status flag stays false after away-and-back'
);

-- 5) Result-only grading preserves stamp
SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT commish FROM stamp_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM stamp_ids),
      (SELECT week FROM stamp_ids),
      (SELECT team_det FROM stamp_ids),
      'Stamp for grading'
    )->>'audit_id') IS NOT NULL
  ),
  'override before result-only grading'
);
SELECT tests.clear_auth();
UPDATE stamp_ids SET first_audit = (
  SELECT last_commissioner_override_audit_id FROM public.picks
  WHERE user_id = (SELECT player FROM stamp_ids)
    AND week_id = (SELECT week FROM stamp_ids)
);

UPDATE public.picks
SET result = 'win'::public.pick_result
WHERE user_id = (SELECT player FROM stamp_ids)
  AND week_id = (SELECT week FROM stamp_ids);

SELECT is(
  (
    SELECT last_commissioner_override_audit_id FROM public.picks
    WHERE user_id = (SELECT player FROM stamp_ids)
      AND week_id = (SELECT week FROM stamp_ids)
  ),
  (SELECT first_audit FROM stamp_ids),
  'result-only grading update preserves the stamp'
);

SELECT tests.authenticate_as((SELECT player FROM stamp_ids));
SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week FROM stamp_ids))
    WHERE user_id = (SELECT player FROM stamp_ids)
  ),
  true,
  'status flag remains true after result-only grading'
);

-- 7) Later commissioner override replaces prior stamp
SELECT tests.clear_auth();
SELECT tests.authenticate_as((SELECT commish FROM stamp_ids));
SELECT ok(
  (
    SELECT (public.commissioner_override_pick(
      (SELECT player FROM stamp_ids),
      (SELECT week FROM stamp_ids),
      (SELECT team_phi FROM stamp_ids),
      'Replace stamp'
    )->>'audit_id') IS NOT NULL
  ),
  'later commissioner override succeeds'
);
SELECT tests.clear_auth();
UPDATE stamp_ids SET second_audit = (
  SELECT last_commissioner_override_audit_id FROM public.picks
  WHERE user_id = (SELECT player FROM stamp_ids)
    AND week_id = (SELECT week FROM stamp_ids)
);

SELECT ok(
  (
    SELECT second_audit IS NOT NULL
       AND second_audit IS DISTINCT FROM first_audit
    FROM stamp_ids
  ),
  'later commissioner override replaces the prior stamp'
);

SELECT tests.authenticate_as((SELECT player FROM stamp_ids));
SELECT is(
  (
    SELECT currently_commissioner_overridden
    FROM public.week_pick_submission_status((SELECT week FROM stamp_ids))
    WHERE user_id = (SELECT player FROM stamp_ids)
  ),
  true,
  'status flag true after stamp replacement'
);

-- 9) Hidden team privacy: RPC columns only
SELECT ok(
  (
    SELECT bool_and(
      (SELECT array_agg(key ORDER BY key)
       FROM jsonb_object_keys(to_jsonb(r)) AS key)
      =
      ARRAY[
        'currently_commissioner_overridden',
        'has_pick',
        'user_id'
      ]
    )
    FROM public.week_pick_submission_status((SELECT week FROM stamp_ids)) r
  ),
  'submission-status RPC still exposes only user_id, has_pick, currently_commissioner_overridden'
);

SELECT * FROM finish();
ROLLBACK;
