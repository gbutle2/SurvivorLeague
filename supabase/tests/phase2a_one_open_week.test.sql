-- Phase 2A: at most one open week per season (partial unique index).
-- Run via: npm run test:db
-- Requires the weeks_one_open_per_season_idx migration.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(2);

DO $$
DECLARE
  v_commish UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaa10';
  v_league_a UUID := 'cccccccc-cccc-cccc-cccc-cccccccccc10';
  v_league_b UUID := 'cccccccc-cccc-cccc-cccc-cccccccccc11';
  v_season_a UUID := 'dddddddd-dddd-dddd-dddd-dddddddddd10';
  v_season_b UUID := 'dddddddd-dddd-dddd-dddd-dddddddddd11';
BEGIN
  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  )
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    v_commish,
    'authenticated',
    'authenticated',
    'open-week-commish@example.com',
    crypt('x', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"display_name":"Open Week Commish"}',
    now(),
    now()
  );

  INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
  VALUES
    (v_league_a, 'Open Week League A', 'open-week-a', 'America/Chicago', v_commish),
    (v_league_b, 'Open Week League B', 'open-week-b', 'America/Chicago', v_commish);

  INSERT INTO public.league_members (league_id, user_id, role, active) VALUES
    (v_league_a, v_commish, 'commissioner', true),
    (v_league_b, v_commish, 'commissioner', true);

  INSERT INTO public.seasons (id, league_id, year, status) VALUES
    (v_season_a, v_league_a, 2026, 'active'),
    (v_season_b, v_league_b, 2026, 'active');

  CREATE TEMP TABLE open_week_ids AS
  SELECT v_season_a AS season_a, v_season_b AS season_b;
END;
$$;

-- Separate seasons may each have one open week.
SELECT lives_ok(
  $$
    INSERT INTO public.weeks (season_id, week_number, label, locks_at, status)
    VALUES
      ((SELECT season_a FROM open_week_ids), 1, 'A1', now() + interval '2 days', 'open'),
      ((SELECT season_b FROM open_week_ids), 1, 'B1', now() + interval '2 days', 'open')
  $$,
  'separate seasons may each have one open week'
);

-- Same season cannot have a second open week.
SELECT throws_ok(
  $$
    INSERT INTO public.weeks (season_id, week_number, label, locks_at, status)
    VALUES (
      (SELECT season_a FROM open_week_ids),
      2,
      'A2',
      now() + interval '3 days',
      'open'
    )
  $$,
  '23505',
  NULL,
  'database rejects a second open week for the same season'
);

SELECT * FROM finish();
ROLLBACK;
