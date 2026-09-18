-- Phase 2B-B: pick game_id derivation + provenance spoofing guards.
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

SELECT plan(12);

SELECT tests.clear_auth();

DO $$
DECLARE
  v_player UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';
  v_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02';
  v_league UUID := 'cccccccc-cccc-cccc-cccc-cccccccccc01';
  v_season UUID := 'dddddddd-dddd-dddd-dddd-dddddddddd01';
  v_week UUID := 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01';
  v_game UUID := 'ffffffff-ffff-ffff-ffff-ffffffffff01';
  v_other_game UUID := 'ffffffff-ffff-ffff-ffff-ffffffffff02';
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
     'prov-player@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Prov Player"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_commish, 'authenticated', 'authenticated',
     'prov-commish@example.com', crypt('x', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{"display_name":"Prov Commish"}', now(), now());

  INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
  VALUES (v_league, 'Prov League', 'prov-meta', 'America/Chicago', v_commish);

  INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
    (v_league, v_commish, 'commissioner', true),
    (v_league, v_player, 'player', true);

  INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
  VALUES (v_season, v_league, 2093, 'active', 18);

  INSERT INTO public.weeks (id, season_id, week_number, label, locks_at, status)
  VALUES (v_week, v_season, 1, 'Week 1', now() + interval '7 days', 'open');

  SELECT id INTO v_team_a FROM public.teams WHERE abbreviation = 'KC';
  SELECT id INTO v_team_b FROM public.teams WHERE abbreviation = 'BUF';
  SELECT id INTO v_team_c FROM public.teams WHERE abbreviation = 'MIA';
  SELECT id INTO v_team_d FROM public.teams WHERE abbreviation = 'NYJ';

  INSERT INTO public.games (
    id, provider, provider_game_id, season_year, season_type, regular_week_number,
    home_team_id, away_team_id, scheduled_kickoff_at, status
  ) VALUES
    (v_game, 'nflverse', 'prov-g1', 2093, 'regular', 1,
     v_team_a, v_team_b, now() + interval '2 days', 'scheduled'),
    (v_other_game, 'nflverse', 'prov-g2', 2093, 'regular', 1,
     v_team_c, v_team_d, now() + interval '3 days', 'scheduled');
END;
$$;

-- Player insert derives game_id and forces pending/auto/null reason.
SELECT lives_ok(
  $$SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01');
    INSERT INTO public.picks (week_id, user_id, team_id, result)
    VALUES (
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
      (SELECT id FROM public.teams WHERE abbreviation = 'KC'),
      'pending'
    );
    SELECT tests.clear_auth();$$,
  'player can insert a pending pick'
);

SELECT is(
  (SELECT game_id FROM public.picks
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
      AND week_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'),
  'ffffffff-ffff-ffff-ffff-ffffffffff01'::uuid,
  'INSERT derives game_id from selected team/week'
);

SELECT results_eq(
  $$SELECT result::text, result_source::text, result_override_reason
    FROM public.picks
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
      AND week_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'$$,
  $$VALUES ('pending', 'auto', NULL::text)$$,
  'player-created picks begin pending/auto with null override reason'
);

-- Spoof game_id on INSERT â€” must still store the derived game.
SELECT lives_ok(
  $$SELECT tests.clear_auth();
    DELETE FROM public.picks
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';
    SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01');
    INSERT INTO public.picks (week_id, user_id, team_id, result, game_id, result_source, result_override_reason)
    VALUES (
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01',
      (SELECT id FROM public.teams WHERE abbreviation = 'KC'),
      'win',
      'ffffffff-ffff-ffff-ffff-ffffffffff02',
      'commissioner',
      'spoofed'
    );
    SELECT tests.clear_auth();$$,
  'spoofed INSERT is neutralized by trigger (or accepted only after rewrite)'
);

SELECT results_eq(
  $$SELECT game_id::text, result::text, result_source::text, result_override_reason
    FROM public.picks
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'
      AND week_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeee01'$$,
  $$VALUES (
    'ffffffff-ffff-ffff-ffff-ffffffffff01',
    'pending',
    'auto',
    NULL::text
  )$$,
  'spoofed game_id/result/result_source/reason cannot stick on INSERT'
);

-- Spoof fields on UPDATE
SELECT throws_ok(
  $$SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01');
    UPDATE public.picks
       SET result_source = 'commissioner'
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';
    SELECT tests.clear_auth();$$,
  '42501',
  'Players cannot set result_source or result_override_reason',
  'player UPDATE cannot set result_source'
);

SELECT throws_ok(
  $$SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01');
    UPDATE public.picks
       SET result_override_reason = 'nope'
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';
    SELECT tests.clear_auth();$$,
  '42501',
  'Players cannot set result_source or result_override_reason',
  'player UPDATE cannot set result_override_reason'
);

-- Changing team before kickoff atomically updates game_id
SELECT lives_ok(
  $$SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01');
    UPDATE public.picks
       SET team_id = (SELECT id FROM public.teams WHERE abbreviation = 'MIA')
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';
    SELECT tests.clear_auth();$$,
  'player can change team before kickoff'
);

SELECT is(
  (SELECT game_id FROM public.picks
    WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'),
  'ffffffff-ffff-ffff-ffff-ffffffffff02'::uuid,
  'team change atomically updates derived game_id'
);

-- Commissioner override requires provenance + reason
-- Commissioner override rules (superuser + JWT so RLS cannot hide zero-row updates).
SELECT throws_ok(
  $$SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', true);
    SELECT set_config(
      'request.jwt.claims',
      json_build_object('sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'role', 'authenticated')::text,
      true
    );
    UPDATE public.picks
       SET result = 'win', result_source = 'auto'
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'$$,
  '23514',
  'Commissioner result changes require result_source = commissioner',
  'commissioner result change without commissioner source is rejected'
);

SELECT throws_ok(
  $$SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', true);
    SELECT set_config(
      'request.jwt.claims',
      json_build_object('sub', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02', 'role', 'authenticated')::text,
      true
    );
    UPDATE public.picks
       SET result = 'win',
           result_source = 'commissioner',
           result_override_reason = '   '
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01'$$,
  '23514',
  'Commissioner override requires a nonblank reason',
  'commissioner override without nonblank reason is rejected'
);

SELECT lives_ok(
  $$SELECT tests.authenticate_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa02');
    UPDATE public.picks
       SET result = 'win',
           result_source = 'commissioner',
           result_override_reason = 'Box score corrected'
     WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa01';
    SELECT tests.clear_auth();$$,
  'commissioner override with reason succeeds'
);

SELECT * FROM finish();
ROLLBACK;
