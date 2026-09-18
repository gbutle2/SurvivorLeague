-- Phase 2B-B: NFL games schedule, kickoff-based pick locks, 18-week regular season.
-- Do not apply to remote Supabase until explicitly approved.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE public.nfl_season_type AS ENUM ('regular', 'postseason');
CREATE TYPE public.nfl_game_status AS ENUM (
  'scheduled',
  'in_progress',
  'final',
  'postponed',
  'canceled'
);
CREATE TYPE public.playoff_round_code AS ENUM (
  'wildcard',
  'divisional',
  'conference',
  'superbowl'
);
CREATE TYPE public.sync_run_status AS ENUM (
  'running',
  'succeeded',
  'failed',
  'rejected'
);
CREATE TYPE public.pick_result_source AS ENUM ('auto', 'commissioner');
CREATE TYPE public.schedule_review_kind AS ENUM (
  'post_kickoff_time_change',
  'canceled_game',
  'manual_override_required',
  'unknown_team',
  'other'
);

-- ---------------------------------------------------------------------------
-- Season default: 18 regular weeks
-- ---------------------------------------------------------------------------
ALTER TABLE public.seasons
  ALTER COLUMN regular_week_count SET DEFAULT 18;

UPDATE public.seasons
SET regular_week_count = 18
WHERE regular_week_count = 17;

ALTER TABLE public.seasons
  DROP CONSTRAINT IF EXISTS seasons_regular_week_count_positive;

ALTER TABLE public.seasons
  ADD CONSTRAINT seasons_regular_week_count_range
  CHECK (regular_week_count BETWEEN 1 AND 18);

-- ---------------------------------------------------------------------------
-- Games
-- ---------------------------------------------------------------------------
CREATE TABLE public.games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'nflverse',
  provider_game_id TEXT NOT NULL,
  season_year INTEGER NOT NULL,
  season_type public.nfl_season_type NOT NULL,
  regular_week_number INTEGER NULL,
  playoff_round public.playoff_round_code NULL,
  home_team_id UUID NOT NULL REFERENCES public.teams (id),
  away_team_id UUID NOT NULL REFERENCES public.teams (id),
  scheduled_kickoff_at TIMESTAMPTZ NOT NULL,
  status public.nfl_game_status NOT NULL DEFAULT 'scheduled',
  home_score INTEGER NULL,
  away_score INTEGER NULL,
  winner_team_id UUID NULL REFERENCES public.teams (id),
  provider_updated_at TIMESTAMPTZ NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  manual_override BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT games_provider_game_unique UNIQUE (provider, provider_game_id),
  CONSTRAINT games_home_away_differ CHECK (home_team_id <> away_team_id),
  CONSTRAINT games_winner_is_participant CHECK (
    winner_team_id IS NULL
    OR winner_team_id = home_team_id
    OR winner_team_id = away_team_id
  ),
  CONSTRAINT games_final_requires_scores CHECK (
    status <> 'final'
    OR (home_score IS NOT NULL AND away_score IS NOT NULL)
  ),
  CONSTRAINT games_regular_week_range CHECK (
    regular_week_number IS NULL
    OR regular_week_number BETWEEN 1 AND 18
  ),
  CONSTRAINT games_season_fields_consistent CHECK (
    (
      season_type = 'regular'
      AND regular_week_number IS NOT NULL
      AND playoff_round IS NULL
    )
    OR (
      season_type = 'postseason'
      AND playoff_round IS NOT NULL
      AND regular_week_number IS NULL
    )
  )
);

CREATE INDEX games_season_year_type_idx
  ON public.games (season_year, season_type);
CREATE INDEX games_regular_week_idx
  ON public.games (season_year, regular_week_number)
  WHERE season_type = 'regular';
CREATE INDEX games_playoff_round_idx
  ON public.games (season_year, playoff_round)
  WHERE season_type = 'postseason';
CREATE INDEX games_kickoff_idx
  ON public.games (scheduled_kickoff_at);

-- One appearance per team per regular week / playoff round (non-canceled).
CREATE UNIQUE INDEX games_team_once_regular_home
  ON public.games (season_year, regular_week_number, home_team_id)
  WHERE season_type = 'regular' AND status <> 'canceled';
CREATE UNIQUE INDEX games_team_once_regular_away
  ON public.games (season_year, regular_week_number, away_team_id)
  WHERE season_type = 'regular' AND status <> 'canceled';
CREATE UNIQUE INDEX games_team_once_playoff_home
  ON public.games (season_year, playoff_round, home_team_id)
  WHERE season_type = 'postseason' AND status <> 'canceled';
CREATE UNIQUE INDEX games_team_once_playoff_away
  ON public.games (season_year, playoff_round, away_team_id)
  WHERE season_type = 'postseason' AND status <> 'canceled';

CREATE TRIGGER games_set_updated_at
BEFORE UPDATE ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Sync audit + schedule review queue
-- ---------------------------------------------------------------------------
CREATE TABLE public.schedule_sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'nflverse',
  season_year INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  status public.sync_run_status NOT NULL DEFAULT 'running',
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  source_freshness_at TIMESTAMPTZ NULL,
  error_summary TEXT NULL,
  warning_summary TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT schedule_sync_runs_counts_nonnegative CHECK (
    inserted_count >= 0
    AND updated_count >= 0
    AND skipped_count >= 0
    AND rejected_count >= 0
  )
);

CREATE INDEX schedule_sync_runs_season_started_idx
  ON public.schedule_sync_runs (season_year, started_at DESC);

CREATE TABLE public.schedule_review_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_year INTEGER NOT NULL,
  game_id UUID NULL REFERENCES public.games (id) ON DELETE SET NULL,
  provider_game_id TEXT NULL,
  kind public.schedule_review_kind NOT NULL,
  summary TEXT NOT NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_at TIMESTAMPTZ NULL,
  resolved_by UUID NULL REFERENCES public.profiles (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX schedule_review_items_open_idx
  ON public.schedule_review_items (season_year, resolved, created_at DESC);

-- ---------------------------------------------------------------------------
-- Pick result provenance (sync must not overwrite commissioner corrections)
-- ---------------------------------------------------------------------------
ALTER TABLE public.picks
  ADD COLUMN IF NOT EXISTS result_source public.pick_result_source NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS result_override_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS game_id UUID NULL REFERENCES public.games (id);

ALTER TABLE public.playoff_picks
  ADD COLUMN IF NOT EXISTS result_source public.pick_result_source NOT NULL DEFAULT 'auto',
  ADD COLUMN IF NOT EXISTS result_override_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS game_id UUID NULL REFERENCES public.games (id);

CREATE INDEX picks_game_id_idx ON public.picks (game_id);
CREATE INDEX playoff_picks_game_id_idx ON public.playoff_picks (game_id);

-- ---------------------------------------------------------------------------
-- Playoff rounds: stable codes via round_number 1..4
-- ---------------------------------------------------------------------------
ALTER TABLE public.playoff_rounds
  ADD COLUMN IF NOT EXISTS round_code public.playoff_round_code;

UPDATE public.playoff_rounds
SET round_code = CASE round_number
  WHEN 1 THEN 'wildcard'::public.playoff_round_code
  WHEN 2 THEN 'divisional'::public.playoff_round_code
  WHEN 3 THEN 'conference'::public.playoff_round_code
  WHEN 4 THEN 'superbowl'::public.playoff_round_code
  ELSE round_code
END
WHERE round_code IS NULL;

ALTER TABLE public.playoff_rounds
  DROP CONSTRAINT IF EXISTS playoff_rounds_round_number_positive;

ALTER TABLE public.playoff_rounds
  ADD CONSTRAINT playoff_rounds_round_number_range
  CHECK (round_number BETWEEN 1 AND 4);

CREATE UNIQUE INDEX IF NOT EXISTS playoff_rounds_season_code_unique
  ON public.playoff_rounds (season_id, round_code)
  WHERE round_code IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Game helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_for_regular_team(
  p_season_year INTEGER,
  p_week_number INTEGER,
  p_team_id UUID
)
RETURNS public.games
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.*
  FROM public.games g
  WHERE g.season_year = p_season_year
    AND g.season_type = 'regular'
    AND g.regular_week_number = p_week_number
    AND g.status <> 'canceled'
    AND (g.home_team_id = p_team_id OR g.away_team_id = p_team_id)
  ORDER BY g.scheduled_kickoff_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.game_for_playoff_team(
  p_season_year INTEGER,
  p_round public.playoff_round_code,
  p_team_id UUID
)
RETURNS public.games
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT g.*
  FROM public.games g
  WHERE g.season_year = p_season_year
    AND g.season_type = 'postseason'
    AND g.playoff_round = p_round
    AND g.status <> 'canceled'
    AND (g.home_team_id = p_team_id OR g.away_team_id = p_team_id)
  ORDER BY g.scheduled_kickoff_at ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.team_regular_game_is_unlocked(
  p_season_year INTEGER,
  p_week_number INTEGER,
  p_team_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.game_for_regular_team(p_season_year, p_week_number, p_team_id) g
    WHERE g.status IN ('scheduled', 'postponed')
      AND g.scheduled_kickoff_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.team_playoff_game_is_unlocked(
  p_season_year INTEGER,
  p_round public.playoff_round_code,
  p_team_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.game_for_playoff_team(p_season_year, p_round, p_team_id) g
    WHERE g.status IN ('scheduled', 'postponed')
      AND g.scheduled_kickoff_at > now()
  );
$$;

-- Effective regular week from schedule (not stored week status / locks_at).
CREATE OR REPLACE FUNCTION public.effective_current_week_id(p_season_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id
  FROM public.weeks w
  INNER JOIN public.seasons s ON s.id = w.season_id
  WHERE w.season_id = p_season_id
    AND s.status = 'active'
    AND EXISTS (
      SELECT 1
      FROM public.games g
      WHERE g.season_year = s.year
        AND g.season_type = 'regular'
        AND g.regular_week_number = w.week_number
        AND g.status NOT IN ('final', 'canceled')
    )
    AND EXISTS (
      SELECT 1
      FROM public.games g
      WHERE g.season_year = s.year
        AND g.season_type = 'regular'
        AND g.regular_week_number = w.week_number
        AND g.scheduled_kickoff_at > now()
        AND g.status IN ('scheduled', 'postponed')
    )
  ORDER BY w.week_number ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.week_is_effective_current(p_week_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.weeks w
    WHERE w.id = p_week_id
      AND public.effective_current_week_id(w.season_id) IS NOT DISTINCT FROM w.id
  );
$$;

CREATE OR REPLACE FUNCTION public.effective_current_playoff_round_id(p_season_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT pr.id
  FROM public.playoff_rounds pr
  INNER JOIN public.seasons s ON s.id = pr.season_id
  WHERE pr.season_id = p_season_id
    AND s.status = 'active'
    AND pr.round_code IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.games g
      WHERE g.season_year = s.year
        AND g.season_type = 'postseason'
        AND g.playoff_round = pr.round_code
        AND g.status NOT IN ('final', 'canceled')
    )
    AND EXISTS (
      SELECT 1
      FROM public.games g
      WHERE g.season_year = s.year
        AND g.season_type = 'postseason'
        AND g.playoff_round = pr.round_code
        AND g.scheduled_kickoff_at > now()
        AND g.status IN ('scheduled', 'postponed')
    )
  ORDER BY pr.round_number ASC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.playoff_round_is_effective_current(p_round_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.playoff_rounds pr
    WHERE pr.id = p_round_id
      AND public.effective_current_playoff_round_id(pr.season_id)
        IS NOT DISTINCT FROM pr.id
  );
$$;

CREATE OR REPLACE FUNCTION public.season_year_for_week(p_week_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.year
  FROM public.weeks w
  INNER JOIN public.seasons s ON s.id = w.season_id
  WHERE w.id = p_week_id;
$$;

CREATE OR REPLACE FUNCTION public.week_number_for_week(p_week_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.week_number FROM public.weeks w WHERE w.id = p_week_id;
$$;

CREATE OR REPLACE FUNCTION public.season_is_active_for_week(p_week_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.weeks w
    INNER JOIN public.seasons s ON s.id = w.season_id
    WHERE w.id = p_week_id
      AND s.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.pick_team_plays_unlocked_in_week(
  p_week_id UUID,
  p_team_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.team_regular_game_is_unlocked(
    public.season_year_for_week(p_week_id),
    public.week_number_for_week(p_week_id),
    p_team_id
  );
$$;

CREATE OR REPLACE FUNCTION public.player_eligible_for_playoff_round(
  p_round_id UUID,
  p_user_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id UUID;
  v_round_number INTEGER;
  v_prior RECORD;
  v_pick public.playoff_picks%ROWTYPE;
  v_has_future BOOLEAN;
BEGIN
  SELECT pr.season_id, pr.round_number
  INTO v_season_id, v_round_number
  FROM public.playoff_rounds pr
  WHERE pr.id = p_round_id;

  IF v_season_id IS NULL THEN
    RETURN false;
  END IF;

  FOR v_prior IN
    SELECT pr.id, pr.round_code
    FROM public.playoff_rounds pr
    WHERE pr.season_id = v_season_id
      AND pr.round_number < v_round_number
    ORDER BY pr.round_number
  LOOP
    -- Prior round must be complete (no remaining future kickoffs) before
    -- enforcing miss/loss elimination into later rounds.
    SELECT EXISTS (
      SELECT 1
      FROM public.games g
      INNER JOIN public.seasons s ON s.year = g.season_year
      WHERE s.id = v_season_id
        AND g.season_type = 'postseason'
        AND g.playoff_round = v_prior.round_code
        AND g.scheduled_kickoff_at > now()
        AND g.status IN ('scheduled', 'postponed')
    ) INTO v_has_future;

    IF v_has_future THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_pick
    FROM public.playoff_picks pp
    WHERE pp.playoff_round_id = v_prior.id
      AND pp.user_id = p_user_id;

    IF NOT FOUND THEN
      RETURN false; -- missed completed round
    END IF;

    IF v_pick.result IN ('loss', 'tie') THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- Player pick RLS: kickoff authority (not weeks.locks_at)
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS picks_insert_own_before_lock ON public.picks;
CREATE POLICY picks_insert_own_before_lock
ON public.picks
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.season_is_active_for_week(week_id)
  AND public.week_is_effective_current(week_id)
  AND public.pick_team_plays_unlocked_in_week(week_id, team_id)
);

DROP POLICY IF EXISTS picks_update_own_before_lock ON public.picks;
CREATE POLICY picks_update_own_before_lock
ON public.picks
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.season_is_active_for_week(week_id)
  AND public.week_is_effective_current(week_id)
  AND public.pick_team_plays_unlocked_in_week(week_id, team_id)
)
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.season_is_active_for_week(week_id)
  AND public.week_is_effective_current(week_id)
  AND public.pick_team_plays_unlocked_in_week(week_id, team_id)
);

DROP POLICY IF EXISTS playoff_picks_insert_own_before_lock ON public.playoff_picks;
CREATE POLICY playoff_picks_insert_own_before_lock
ON public.playoff_picks
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND points_awarded = 0
  AND public.is_active_league_member(
    public.league_id_for_playoff_round(playoff_round_id)
  )
  AND public.playoff_round_is_effective_current(playoff_round_id)
  AND public.player_eligible_for_playoff_round(playoff_round_id, auth.uid())
  AND public.team_playoff_game_is_unlocked(
    (
      SELECT s.year
      FROM public.playoff_rounds pr
      INNER JOIN public.seasons s ON s.id = pr.season_id
      WHERE pr.id = playoff_round_id
    ),
    (
      SELECT pr.round_code
      FROM public.playoff_rounds pr
      WHERE pr.id = playoff_round_id
    ),
    team_id
  )
);

DROP POLICY IF EXISTS playoff_picks_update_own_before_lock ON public.playoff_picks;
CREATE POLICY playoff_picks_update_own_before_lock
ON public.playoff_picks
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND public.is_active_league_member(
    public.league_id_for_playoff_round(playoff_round_id)
  )
  AND public.playoff_round_is_effective_current(playoff_round_id)
  AND public.player_eligible_for_playoff_round(playoff_round_id, auth.uid())
  AND public.team_playoff_game_is_unlocked(
    (
      SELECT s.year
      FROM public.playoff_rounds pr
      INNER JOIN public.seasons s ON s.id = pr.season_id
      WHERE pr.id = playoff_round_id
    ),
    (
      SELECT pr.round_code
      FROM public.playoff_rounds pr
      WHERE pr.id = playoff_round_id
    ),
    team_id
  )
)
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND points_awarded = 0
  AND public.is_active_league_member(
    public.league_id_for_playoff_round(playoff_round_id)
  )
  AND public.playoff_round_is_effective_current(playoff_round_id)
  AND public.player_eligible_for_playoff_round(playoff_round_id, auth.uid())
  AND public.team_playoff_game_is_unlocked(
    (
      SELECT s.year
      FROM public.playoff_rounds pr
      INNER JOIN public.seasons s ON s.id = pr.season_id
      WHERE pr.id = playoff_round_id
    ),
    (
      SELECT pr.round_code
      FROM public.playoff_rounds pr
      WHERE pr.id = playoff_round_id
    ),
    team_id
  )
);

-- ---------------------------------------------------------------------------
-- RLS for games / sync tables
-- ---------------------------------------------------------------------------
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_review_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY games_select_authenticated
ON public.games
FOR SELECT
TO authenticated
USING (true);

-- Writes go through server-side DB connection / SECURITY DEFINER sync helpers.
-- No direct authenticated INSERT/UPDATE/DELETE on games.

CREATE POLICY schedule_sync_runs_select_members
ON public.schedule_sync_runs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.seasons s
    WHERE s.year = schedule_sync_runs.season_year
      AND public.is_active_league_member(s.league_id)
  )
);

CREATE POLICY schedule_review_items_select_members
ON public.schedule_review_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.seasons s
    WHERE s.year = schedule_review_items.season_year
      AND public.is_active_league_member(s.league_id)
  )
);

CREATE POLICY schedule_review_items_update_commissioner
ON public.schedule_review_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.seasons s
    WHERE s.year = schedule_review_items.season_year
      AND public.is_league_commissioner(s.league_id)
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.seasons s
    WHERE s.year = schedule_review_items.season_year
      AND public.is_league_commissioner(s.league_id)
  )
);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.game_for_regular_team(INTEGER, INTEGER, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.game_for_playoff_team(INTEGER, public.playoff_round_code, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_regular_game_is_unlocked(INTEGER, INTEGER, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_playoff_game_is_unlocked(INTEGER, public.playoff_round_code, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.effective_current_playoff_round_id(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.playoff_round_is_effective_current(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pick_team_plays_unlocked_in_week(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.player_eligible_for_playoff_round(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.season_year_for_week(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.week_number_for_week(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.season_is_active_for_week(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.game_for_regular_team(INTEGER, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.game_for_playoff_team(INTEGER, public.playoff_round_code, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_regular_game_is_unlocked(INTEGER, INTEGER, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.team_playoff_game_is_unlocked(INTEGER, public.playoff_round_code, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.effective_current_playoff_round_id(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.playoff_round_is_effective_current(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pick_team_plays_unlocked_in_week(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.player_eligible_for_playoff_round(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.season_year_for_week(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.week_number_for_week(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.season_is_active_for_week(UUID) TO authenticated;

COMMENT ON TABLE public.games IS
  'NFL schedule/results synced from a fixed server-side provider (nflverse).';
COMMENT ON FUNCTION public.effective_current_week_id(UUID) IS
  'Lowest regular week with a non-final/canceled game and at least one future kickoff.';
COMMENT ON FUNCTION public.team_regular_game_is_unlocked(INTEGER, INTEGER, UUID) IS
  'True when the team has a scheduled/postponed game with scheduled_kickoff_at > now().';
