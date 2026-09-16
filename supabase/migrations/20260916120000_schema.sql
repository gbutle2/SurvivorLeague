-- Schema for Sunday Survivor Picks (Phase 1)
-- Apply with Supabase CLI: supabase db push
-- Or run in order via the Supabase SQL editor.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE public.member_role AS ENUM ('commissioner', 'player');
CREATE TYPE public.pick_result AS ENUM ('pending', 'win', 'loss', 'tie');
CREATE TYPE public.week_status AS ENUM ('upcoming', 'open', 'locked', 'final');
CREATE TYPE public.season_status AS ENUM ('setup', 'active', 'complete');
CREATE TYPE public.round_status AS ENUM ('upcoming', 'open', 'locked', 'final');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  timezone TEXT NOT NULL DEFAULT 'America/Chicago',
  commissioner_user_id UUID NOT NULL REFERENCES public.profiles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.league_members (
  league_id UUID NOT NULL REFERENCES public.leagues (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role public.member_role NOT NULL DEFAULT 'player',
  active BOOLEAN NOT NULL DEFAULT true,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (league_id, user_id),
  CONSTRAINT league_members_unique_membership UNIQUE (league_id, user_id)
);

CREATE TABLE public.seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES public.leagues (id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  regular_week_count INTEGER NOT NULL DEFAULT 17,
  status public.season_status NOT NULL DEFAULT 'setup',
  season_complete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT seasons_unique_league_year UNIQUE (league_id, year),
  CONSTRAINT seasons_regular_week_count_positive CHECK (regular_week_count > 0)
);

CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  abbreviation TEXT NOT NULL,
  city TEXT NOT NULL,
  name TEXT NOT NULL,
  conference TEXT NOT NULL,
  division TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT teams_unique_abbreviation UNIQUE (abbreviation),
  CONSTRAINT teams_conference_check CHECK (conference IN ('AFC', 'NFC')),
  CONSTRAINT teams_division_check CHECK (
    division IN ('East', 'North', 'South', 'West')
  )
);

CREATE TABLE public.weeks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.seasons (id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  label TEXT NOT NULL,
  locks_at TIMESTAMPTZ NOT NULL,
  status public.week_status NOT NULL DEFAULT 'upcoming',
  CONSTRAINT weeks_unique_season_week UNIQUE (season_id, week_number),
  CONSTRAINT weeks_week_number_positive CHECK (week_number > 0)
);

CREATE TABLE public.picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_id UUID NOT NULL REFERENCES public.weeks (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams (id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result public.pick_result NOT NULL DEFAULT 'pending',
  CONSTRAINT picks_unique_week_user UNIQUE (week_id, user_id)
);

CREATE TABLE public.playoff_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.seasons (id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  points INTEGER NOT NULL,
  locks_at TIMESTAMPTZ NOT NULL,
  status public.round_status NOT NULL DEFAULT 'upcoming',
  CONSTRAINT playoff_rounds_unique_season_round UNIQUE (season_id, round_number),
  CONSTRAINT playoff_rounds_round_number_positive CHECK (round_number > 0),
  CONSTRAINT playoff_rounds_points_nonnegative CHECK (points >= 0)
);

CREATE TABLE public.playoff_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  playoff_round_id UUID NOT NULL REFERENCES public.playoff_rounds (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams (id),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  result public.pick_result NOT NULL DEFAULT 'pending',
  points_awarded INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT playoff_picks_unique_round_user UNIQUE (playoff_round_id, user_id),
  CONSTRAINT playoff_picks_points_awarded_nonnegative CHECK (points_awarded >= 0)
);

CREATE TABLE public.scoring_rules (
  season_id UUID PRIMARY KEY REFERENCES public.seasons (id) ON DELETE CASCADE,
  correct_regular_pick_points INTEGER NOT NULL DEFAULT 1,
  best_record_bonus INTEGER NOT NULL DEFAULT 4,
  longest_streak_bonus INTEGER NOT NULL DEFAULT 4,
  survivor_bonus INTEGER NOT NULL DEFAULT 10,
  wildcard_points INTEGER NOT NULL DEFAULT 2,
  divisional_points INTEGER NOT NULL DEFAULT 4,
  conference_points INTEGER NOT NULL DEFAULT 6,
  superbowl_points INTEGER NOT NULL DEFAULT 12,
  perfect_season_override BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX league_members_user_id_idx ON public.league_members (user_id);
CREATE INDEX seasons_league_id_idx ON public.seasons (league_id);
CREATE INDEX weeks_season_id_idx ON public.weeks (season_id);
CREATE INDEX picks_week_id_idx ON public.picks (week_id);
CREATE INDEX picks_user_id_idx ON public.picks (user_id);
CREATE INDEX picks_team_id_idx ON public.picks (team_id);
CREATE INDEX playoff_rounds_season_id_idx ON public.playoff_rounds (season_id);
CREATE INDEX playoff_picks_round_id_idx ON public.playoff_picks (playoff_round_id);
CREATE INDEX playoff_picks_user_id_idx ON public.playoff_picks (user_id);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_set_updated_at
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER picks_set_updated_at
BEFORE UPDATE ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER playoff_picks_set_updated_at
BEFORE UPDATE ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Auto-create a profile when a user is invited/created in Auth.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data ->> 'display_name',
      split_part(NEW.email, '@', 1),
      'Player'
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();
