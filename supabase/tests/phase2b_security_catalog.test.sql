-- Catalog assertions for intended post-Phase-2B-B pick security objects.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(16);

-- Obsolete triggers must not exist
SELECT is(
  (
    SELECT count(*)::integer
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
      AND t.tgname IN (
        'picks_enforce_player_columns',
        'playoff_picks_enforce_player_columns'
      )
  ),
  0,
  'obsolete player_columns triggers do not exist'
);

-- Intended regular triggers exist exactly once and invoke expected functions
SELECT is(
  (
    SELECT string_agg(t.tgname::text || '=' || p.proname::text, ',' ORDER BY t.tgname::text COLLATE "C")
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname = 'picks'
      AND NOT t.tgisinternal
      AND t.tgname IN (
        'picks_enforce_insert_audit',
        'picks_enforce_update_guards',
        'picks_enforce_result_permissions',
        'picks_enforce_unique_team_per_season',
        'picks_enforce_game_and_provenance'
      )
  ),
  'picks_enforce_game_and_provenance=enforce_regular_pick_game_and_provenance,picks_enforce_insert_audit=enforce_regular_pick_insert_audit,picks_enforce_result_permissions=enforce_regular_pick_result_permissions,picks_enforce_unique_team_per_season=enforce_unique_team_per_season,picks_enforce_update_guards=enforce_regular_pick_update_guards',
  'regular pick security triggers exist exactly once with expected functions'
);

SELECT is(
  (
    SELECT string_agg(t.tgname::text || '=' || p.proname::text, ',' ORDER BY t.tgname::text COLLATE "C")
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname = 'playoff_picks'
      AND NOT t.tgisinternal
      AND t.tgname IN (
        'playoff_picks_enforce_insert_audit',
        'playoff_picks_enforce_update_guards',
        'playoff_picks_enforce_result_permissions',
        'playoff_picks_enforce_unique_team_per_playoff',
        'playoff_picks_enforce_game_and_provenance'
      )
  ),
  'playoff_picks_enforce_game_and_provenance=enforce_playoff_pick_game_and_provenance,playoff_picks_enforce_insert_audit=enforce_playoff_pick_insert_audit,playoff_picks_enforce_result_permissions=enforce_playoff_pick_result_permissions,playoff_picks_enforce_unique_team_per_playoff=enforce_unique_team_per_playoff,playoff_picks_enforce_update_guards=enforce_playoff_pick_update_guards',
  'playoff pick security triggers exist exactly once with expected functions'
);

-- No duplicate intended trigger names
SELECT is(
  (
    SELECT count(*)::integer
    FROM (
      SELECT t.tgname
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('picks', 'playoff_picks')
        AND NOT t.tgisinternal
        AND t.tgname LIKE '%enforce_%'
      GROUP BY t.tgname
      HAVING count(*) > 1
    ) dups
  ),
  0,
  'no duplicate enforce_* trigger names on picks tables'
);

-- PUBLIC must not execute internal SECURITY DEFINER mutation helpers
SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.routine_privileges
    WHERE specific_schema = 'public'
      AND grantee = 'PUBLIC'
      AND privilege_type = 'EXECUTE'
      AND routine_name IN (
        'enforce_unique_team_per_season',
        'enforce_unique_team_per_playoff',
        'enforce_regular_pick_insert_audit',
        'enforce_playoff_pick_insert_audit',
        'enforce_regular_pick_update_guards',
        'enforce_playoff_pick_update_guards',
        'enforce_regular_pick_result_permissions',
        'enforce_playoff_pick_result_permissions',
        'enforce_regular_pick_game_and_provenance',
        'enforce_playoff_pick_game_and_provenance',
        'sync_game_participants',
        'games_maintain_participants'
      )
  ),
  0,
  'internal SECURITY DEFINER functions are not executable by PUBLIC'
);

-- authenticated must not execute internal maintenance functions directly
SELECT is(
  (
    SELECT count(*)::integer
    FROM information_schema.routine_privileges
    WHERE specific_schema = 'public'
      AND grantee = 'authenticated'
      AND privilege_type = 'EXECUTE'
      AND routine_name IN (
        'enforce_unique_team_per_season',
        'enforce_unique_team_per_playoff',
        'enforce_regular_pick_insert_audit',
        'enforce_playoff_pick_insert_audit',
        'enforce_regular_pick_update_guards',
        'enforce_playoff_pick_update_guards',
        'enforce_regular_pick_result_permissions',
        'enforce_playoff_pick_result_permissions',
        'enforce_regular_pick_game_and_provenance',
        'enforce_playoff_pick_game_and_provenance',
        'sync_game_participants',
        'games_maintain_participants'
      )
  ),
  0,
  'authenticated cannot execute internal maintenance functions directly'
);

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
  v_player UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1';
  v_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca2';
  v_league UUID := 'cccccccc-cccc-cccc-cccc-cccccccccca1';
  v_season UUID := 'dddddddd-dddd-dddd-dddd-dddddddddca1';
  v_week UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeca1';
  v_week2 UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeca2';
  v_game UUID := 'ffffffff-ffff-ffff-ffff-ffffffffca01';
  v_game2 UUID := 'ffffffff-ffff-ffff-ffff-ffffffffca02';
  v_team_a UUID;
  v_team_b UUID;
  v_team_c UUID;
  v_team_d UUID;
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) VALUES
    ('00000000-0000-0000-0000-000000000000', v_player, 'authenticated', 'authenticated',
     'catalog-player@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Catalog Player"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_commish, 'authenticated', 'authenticated',
     'catalog-commish@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Catalog Commish"}', now(), now());

  INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
  VALUES (v_league, 'Catalog League', 'catalog-sec', 'America/Chicago', v_commish);

  INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
    (v_league, v_commish, 'commissioner', true),
    (v_league, v_player, 'player', true);

  INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
  VALUES (v_season, v_league, 2097, 'active', 18);

  INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status) VALUES
    (v_week, v_season, 1, 'Week 1', now() + interval '7 days', 'open'),
    (v_week2, v_season, 2, 'Week 2', now() + interval '14 days', 'upcoming');

  SELECT id INTO v_team_a FROM public.teams WHERE abbreviation = 'KC';
  SELECT id INTO v_team_b FROM public.teams WHERE abbreviation = 'BUF';
  SELECT id INTO v_team_c FROM public.teams WHERE abbreviation = 'MIA';
  SELECT id INTO v_team_d FROM public.teams WHERE abbreviation = 'NYJ';

  INSERT INTO public.games (
    id, provider, provider_game_id, season_year, season_type, regular_week_number,
    home_team_id, away_team_id, scheduled_kickoff_at, status
  ) VALUES
    (v_game, 'nflverse', 'cat-g1', 2097, 'regular', 1,
     v_team_a, v_team_b, now() + interval '2 days', 'scheduled'),
    (v_game2, 'nflverse', 'cat-g2', 2097, 'regular', 1,
     v_team_c, v_team_d, now() + interval '3 days', 'scheduled'),
    (gen_random_uuid(), 'nflverse', 'cat-w2', 2097, 'regular', 2,
     v_team_a, v_team_c, now() + interval '10 days', 'scheduled');
END;
$$;

-- Direct EXECUTE of internal function as authenticated must fail
SELECT throws_ok(
  $$SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1');
    SELECT public.enforce_unique_team_per_season();
    SELECT tests.clear_auth();$$,
  '42501',
  NULL,
  'authenticated cannot call enforce_unique_team_per_season directly'
);

-- Valid player insert works
SELECT lives_ok(
  $$SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1');
    INSERT INTO public.picks (week_id, user_id, team_id, result)
    VALUES (
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeca1',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1',
      (SELECT id FROM public.teams WHERE abbreviation = 'KC'),
      'pending'
    );
    SELECT tests.clear_auth();$$,
  'normal valid player pick insert still works'
);

-- Timestamp spoof on insert is neutralized
SELECT ok(
  (
    SELECT submitted_at > now() - interval '1 minute'
       AND updated_at > now() - interval '1 minute'
       AND submitted_at > timestamptz '2020-01-01'
    FROM public.picks
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1'
  ),
  'insert timestamps are database-controlled'
);

SELECT lives_ok(
  $$SELECT tests.clear_auth();
    DELETE FROM public.picks WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1';
    SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1');
    INSERT INTO public.picks (
      week_id, user_id, team_id, result, submitted_at, updated_at,
      game_id, result_source, result_override_reason
    ) VALUES (
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeca1',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1',
      (SELECT id FROM public.teams WHERE abbreviation = 'KC'),
      'win',
      '2020-01-01 00:00:00+00',
      '2020-01-01 00:00:00+00',
      'ffffffff-ffff-ffff-ffff-ffffffffca02',
      'commissioner',
      'spoof'
    );
    SELECT tests.clear_auth();$$,
  'spoofed insert is accepted only after trigger rewrite'
);

SELECT results_eq(
  $$SELECT result::text, result_source::text, result_override_reason,
           game_id::text,
           (submitted_at > now() - interval '1 minute') AS fresh_submitted
    FROM public.picks
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1'$$,
  $$VALUES (
    'pending', 'auto', NULL::text,
    'ffffffff-ffff-ffff-ffff-ffffffffca01',
    true
  )$$,
  'players cannot spoof game/provenance/timestamps on insert'
);

SELECT throws_ok(
  $$SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1');
    UPDATE public.picks
       SET week_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeca2'
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1';
    SELECT tests.clear_auth();$$,
  '42501',
  NULL,
  'authenticated players cannot modify immutable identity fields'
);

SELECT throws_ok(
  $$SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1');
    UPDATE public.picks
       SET result_source = 'commissioner'
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1';
    SELECT tests.clear_auth();$$,
  '42501',
  NULL,
  'authenticated players cannot spoof provenance fields'
);

SELECT throws_ok(
  $$SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca2', true);
    SELECT set_config(
      'request.jwt.claims',
      json_build_object('sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca2', 'role', 'authenticated')::text,
      true
    );
    UPDATE public.picks
       SET result = 'win',
           result_source = 'commissioner',
           result_override_reason = '   '
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1'$$,
  '23514',
  NULL,
  'commissioner overrides still require a nonblank reason'
);

SELECT lives_ok(
  $$SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1');
    UPDATE public.picks
       SET team_id = (SELECT id FROM public.teams WHERE abbreviation = 'MIA')
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1';
    SELECT tests.clear_auth();$$,
  'normal valid player pick update still works'
);

SELECT throws_ok(
  $$SELECT tests.clear_auth();
    INSERT INTO public.picks (week_id, user_id, team_id, result)
    VALUES (
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeca2',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaca1',
      (SELECT id FROM public.teams WHERE abbreviation = 'MIA'),
      'pending'
    );$$,
  '23514',
  NULL,
  'reuse protections still work across weeks'
);

SELECT * FROM finish();
ROLLBACK;
