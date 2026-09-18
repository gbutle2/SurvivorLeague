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

-- Normalized participants: one non-canceled appearance per team per week/round.
-- Canceled games do not hold participant rows, allowing a replacement game.
CREATE TABLE public.game_participants (
  game_id UUID NOT NULL REFERENCES public.games (id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES public.teams (id),
  season_year INTEGER NOT NULL,
  season_type public.nfl_season_type NOT NULL,
  regular_week_number INTEGER NULL,
  playoff_round public.playoff_round_code NULL,
  PRIMARY KEY (game_id, team_id),
  CONSTRAINT game_participants_regular_fields CHECK (
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

CREATE UNIQUE INDEX game_participants_one_regular_team
  ON public.game_participants (season_year, regular_week_number, team_id)
  WHERE season_type = 'regular';

CREATE UNIQUE INDEX game_participants_one_playoff_team
  ON public.game_participants (season_year, playoff_round, team_id)
  WHERE season_type = 'postseason';

CREATE OR REPLACE FUNCTION public.sync_game_participants(p_game public.games)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first UUID;
  v_second UUID;
  v_scope TEXT;
BEGIN
  DELETE FROM public.game_participants WHERE game_id = p_game.id;

  IF p_game.status = 'canceled' THEN
    RETURN;
  END IF;

  -- Serialize concurrent participant claims; lock team ids in sorted order.
  IF p_game.home_team_id::text < p_game.away_team_id::text THEN
    v_first := p_game.home_team_id;
    v_second := p_game.away_team_id;
  ELSE
    v_first := p_game.away_team_id;
    v_second := p_game.home_team_id;
  END IF;

  v_scope :=
    'game_part/' || p_game.season_year::text || '/' || p_game.season_type::text
    || '/' || coalesce(p_game.regular_week_number::text, p_game.playoff_round::text);

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_scope || '/' || v_first::text, 0)
  );
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_scope || '/' || v_second::text, 0)
  );

  IF EXISTS (
    SELECT 1 FROM public.game_participants gp
    WHERE gp.season_year = p_game.season_year
      AND gp.season_type = p_game.season_type
      AND gp.team_id IN (p_game.home_team_id, p_game.away_team_id)
      AND (
        (p_game.season_type = 'regular'
          AND gp.regular_week_number = p_game.regular_week_number)
        OR (p_game.season_type = 'postseason'
          AND gp.playoff_round = p_game.playoff_round)
      )
      AND gp.game_id <> p_game.id
  ) THEN
    RAISE EXCEPTION 'Team already appears in another non-canceled game for this week/round'
      USING ERRCODE = 'unique_violation';
  END IF;

  INSERT INTO public.game_participants (
    game_id, team_id, season_year, season_type, regular_week_number, playoff_round
  ) VALUES
    (p_game.id, p_game.home_team_id, p_game.season_year, p_game.season_type,
     p_game.regular_week_number, p_game.playoff_round),
    (p_game.id, p_game.away_team_id, p_game.season_year, p_game.season_type,
     p_game.regular_week_number, p_game.playoff_round);
END;
$$;

CREATE OR REPLACE FUNCTION public.games_maintain_participants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.game_participants WHERE game_id = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM public.sync_game_participants(NEW);
  RETURN NEW;
END;
$$;

CREATE TRIGGER games_maintain_participants
AFTER INSERT OR UPDATE OF
  home_team_id, away_team_id, season_year, season_type,
  regular_week_number, playoff_round, status
ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.games_maintain_participants();

CREATE TRIGGER games_delete_participants
AFTER DELETE ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.games_maintain_participants();

COMMENT ON TABLE public.game_participants IS
  'One non-canceled team appearance per regular week or playoff round. Canceled games release slots.';

COMMENT ON COLUMN public.games.manual_override IS
  'When true, automatic sync freezes ALL provider-managed fields on this game (schedule and results).';

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

ALTER TABLE public.game_participants ENABLE ROW LEVEL SECURITY;
-- No authenticated write policies: maintained only via games triggers / server sync.

-- ---------------------------------------------------------------------------
-- Derive game_id and protect scoring provenance from authenticated players.
-- Unauthenticated server paths (schedule sync / bootstrap) remain able to
-- update auto results without weakening player protections.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_regular_pick_game_and_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game public.games%ROWTYPE;
  v_is_commissioner BOOLEAN := false;
BEGIN
  -- Identity mutations are rejected by update_guards; skip game lookup so that
  -- immutability errors surface with a stable privilege error code.
  IF TG_OP = 'UPDATE'
     AND auth.uid() IS NOT NULL
     AND NEW.week_id IS DISTINCT FROM OLD.week_id THEN
    RETURN NEW;
  END IF;

  v_game := public.game_for_regular_team(
    public.season_year_for_week(NEW.week_id),
    public.week_number_for_week(NEW.week_id),
    NEW.team_id
  );

  IF v_game.id IS NULL THEN
    RAISE EXCEPTION 'No scheduled non-canceled game for that team in this week'
      USING ERRCODE = 'check_violation';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    v_is_commissioner := public.is_league_commissioner(
      public.league_id_for_week(
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.week_id ELSE NEW.week_id END
      )
    );

    -- Always derive game_id from team + week; ignore client-supplied values.
    NEW.game_id := v_game.id;

    IF TG_OP = 'INSERT' THEN
      NEW.result := 'pending';
      NEW.result_source := 'auto';
      NEW.result_override_reason := NULL;
      RETURN NEW;
    END IF;

    IF v_is_commissioner THEN
      IF NEW.result IS DISTINCT FROM OLD.result
         OR NEW.result_source IS DISTINCT FROM OLD.result_source
         OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
        IF NEW.result_source IS DISTINCT FROM 'commissioner'::public.pick_result_source THEN
          RAISE EXCEPTION 'Commissioner result changes require result_source = commissioner'
            USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.result_override_reason IS NULL
           OR btrim(NEW.result_override_reason) = '' THEN
          RAISE EXCEPTION 'Commissioner override requires a nonblank reason'
            USING ERRCODE = 'check_violation';
        END IF;
        NEW.result_source := 'commissioner';
        NEW.result_override_reason := btrim(NEW.result_override_reason);
      END IF;
      RETURN NEW;
    END IF;

    -- Authenticated players cannot set or change provenance fields.
    IF NEW.result_source IS DISTINCT FROM OLD.result_source
       OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
      RAISE EXCEPTION 'Players cannot set result_source or result_override_reason'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.result_source := OLD.result_source;
    NEW.result_override_reason := OLD.result_override_reason;
    RETURN NEW;
  END IF;

  -- Unauthenticated server path: require game_id match when supplied; else derive.
  IF NEW.game_id IS NULL THEN
    NEW.game_id := v_game.id;
  ELSIF NEW.game_id IS DISTINCT FROM v_game.id THEN
    RAISE EXCEPTION 'game_id must match the scheduled game for team/week'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_playoff_pick_game_and_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_game public.games%ROWTYPE;
  v_year INTEGER;
  v_round public.playoff_round_code;
  v_is_commissioner BOOLEAN := false;
BEGIN
  IF TG_OP = 'UPDATE'
     AND auth.uid() IS NOT NULL
     AND NEW.playoff_round_id IS DISTINCT FROM OLD.playoff_round_id THEN
    RETURN NEW;
  END IF;

  SELECT s.year, pr.round_code
  INTO v_year, v_round
  FROM public.playoff_rounds pr
  INNER JOIN public.seasons s ON s.id = pr.season_id
  WHERE pr.id = NEW.playoff_round_id;

  v_game := public.game_for_playoff_team(v_year, v_round, NEW.team_id);

  IF v_game.id IS NULL THEN
    RAISE EXCEPTION 'No scheduled non-canceled game for that team in this playoff round'
      USING ERRCODE = 'check_violation';
  END IF;

  IF auth.uid() IS NOT NULL THEN
    v_is_commissioner := public.is_league_commissioner(
      public.league_id_for_playoff_round(
        CASE WHEN TG_OP = 'UPDATE' THEN OLD.playoff_round_id ELSE NEW.playoff_round_id END
      )
    );

    NEW.game_id := v_game.id;

    IF TG_OP = 'INSERT' THEN
      NEW.result := 'pending';
      NEW.result_source := 'auto';
      NEW.result_override_reason := NULL;
      NEW.points_awarded := 0;
      RETURN NEW;
    END IF;

    IF v_is_commissioner THEN
      IF NEW.result IS DISTINCT FROM OLD.result
         OR NEW.points_awarded IS DISTINCT FROM OLD.points_awarded
         OR NEW.result_source IS DISTINCT FROM OLD.result_source
         OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
        IF NEW.result_source IS DISTINCT FROM 'commissioner'::public.pick_result_source THEN
          RAISE EXCEPTION 'Commissioner result changes require result_source = commissioner'
            USING ERRCODE = 'check_violation';
        END IF;
        IF NEW.result_override_reason IS NULL
           OR btrim(NEW.result_override_reason) = '' THEN
          RAISE EXCEPTION 'Commissioner override requires a nonblank reason'
            USING ERRCODE = 'check_violation';
        END IF;
        NEW.result_source := 'commissioner';
        NEW.result_override_reason := btrim(NEW.result_override_reason);
      END IF;
      RETURN NEW;
    END IF;

    IF NEW.result_source IS DISTINCT FROM OLD.result_source
       OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
      RAISE EXCEPTION 'Players cannot set result_source or result_override_reason'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    NEW.result_source := OLD.result_source;
    NEW.result_override_reason := OLD.result_override_reason;
    RETURN NEW;
  END IF;

  IF NEW.game_id IS NULL THEN
    NEW.game_id := v_game.id;
  ELSIF NEW.game_id IS DISTINCT FROM v_game.id THEN
    RAISE EXCEPTION 'game_id must match the scheduled game for team/playoff round'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS picks_enforce_game_and_provenance ON public.picks;
CREATE TRIGGER picks_enforce_game_and_provenance
BEFORE INSERT OR UPDATE OF team_id, week_id, game_id, result, result_source, result_override_reason
ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_regular_pick_game_and_provenance();

DROP TRIGGER IF EXISTS playoff_picks_enforce_game_and_provenance ON public.playoff_picks;
CREATE TRIGGER playoff_picks_enforce_game_and_provenance
BEFORE INSERT OR UPDATE OF
  team_id, playoff_round_id, game_id, result, points_awarded,
  result_source, result_override_reason
ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_playoff_pick_game_and_provenance();

-- Strengthen Phase 1 update guards for the new provenance columns.
CREATE OR REPLACE FUNCTION public.enforce_regular_pick_update_guards()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.week_id IS DISTINCT FROM OLD.week_id
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Pick identity fields are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.is_league_commissioner(public.league_id_for_week(OLD.week_id)) THEN
    IF NEW.result IS DISTINCT FROM OLD.result
       OR NEW.result_source IS DISTINCT FROM OLD.result_source
       OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
      IF NEW.result_source IS DISTINCT FROM 'commissioner'::public.pick_result_source THEN
        RAISE EXCEPTION 'Commissioner result changes require result_source = commissioner'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.result_override_reason IS NULL
         OR btrim(NEW.result_override_reason) = '' THEN
        RAISE EXCEPTION 'Commissioner override requires a nonblank reason'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.result_source := 'commissioner';
      NEW.result_override_reason := btrim(NEW.result_override_reason);
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.result IS DISTINCT FROM OLD.result
     OR NEW.result_source IS DISTINCT FROM OLD.result_source
     OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
    RAISE EXCEPTION 'Players may only change team_id on picks'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_playoff_pick_update_guards()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.playoff_round_id IS DISTINCT FROM OLD.playoff_round_id
     OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'Pick identity fields are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF public.is_league_commissioner(
    public.league_id_for_playoff_round(OLD.playoff_round_id)
  ) THEN
    IF NEW.result IS DISTINCT FROM OLD.result
       OR NEW.points_awarded IS DISTINCT FROM OLD.points_awarded
       OR NEW.result_source IS DISTINCT FROM OLD.result_source
       OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
      IF NEW.result_source IS DISTINCT FROM 'commissioner'::public.pick_result_source THEN
        RAISE EXCEPTION 'Commissioner result changes require result_source = commissioner'
          USING ERRCODE = 'check_violation';
      END IF;
      IF NEW.result_override_reason IS NULL
         OR btrim(NEW.result_override_reason) = '' THEN
        RAISE EXCEPTION 'Commissioner override requires a nonblank reason'
          USING ERRCODE = 'check_violation';
      END IF;
      NEW.result_source := 'commissioner';
      NEW.result_override_reason := btrim(NEW.result_override_reason);
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.result IS DISTINCT FROM OLD.result
     OR NEW.points_awarded IS DISTINCT FROM OLD.points_awarded
     OR NEW.result_source IS DISTINCT FROM OLD.result_source
     OR NEW.result_override_reason IS DISTINCT FROM OLD.result_override_reason THEN
    RAISE EXCEPTION 'Players may only change team_id on playoff picks'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

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
  v_round_complete BOOLEAN;
BEGIN
  SELECT pr.season_id, pr.round_number
  INTO v_season_id, v_round_number
  FROM public.playoff_rounds pr
  WHERE pr.id = p_round_id;

  IF v_season_id IS NULL THEN
    RETURN false;
  END IF;

  FOR v_prior IN
    SELECT pr.id, pr.round_code, pr.round_number
    FROM public.playoff_rounds pr
    WHERE pr.season_id = v_season_id
      AND pr.round_number < v_round_number
    ORDER BY pr.round_number
  LOOP
    -- Prior round must be complete: every non-canceled game is final,
    -- and no future scheduled/postponed kickoffs remain.
    SELECT NOT EXISTS (
      SELECT 1
      FROM public.games g
      INNER JOIN public.seasons s ON s.year = g.season_year
      WHERE s.id = v_season_id
        AND g.season_type = 'postseason'
        AND g.playoff_round = v_prior.round_code
        AND g.status <> 'canceled'
        AND (
          g.status <> 'final'
          OR (g.scheduled_kickoff_at > now() AND g.status IN ('scheduled', 'postponed'))
        )
    )
    AND EXISTS (
      SELECT 1
      FROM public.games g
      INNER JOIN public.seasons s ON s.year = g.season_year
      WHERE s.id = v_season_id
        AND g.season_type = 'postseason'
        AND g.playoff_round = v_prior.round_code
        AND g.status = 'final'
    )
    INTO v_round_complete;

    IF NOT coalesce(v_round_complete, false) THEN
      RETURN false; -- previous round still underway or incomplete
    END IF;

    SELECT * INTO v_pick
    FROM public.playoff_picks pp
    WHERE pp.playoff_round_id = v_prior.id
      AND pp.user_id = p_user_id;

    IF NOT FOUND THEN
      RETURN false; -- missed completed round
    END IF;

    -- Only an explicit win advances. Pending/loss/tie are ineligible.
    IF v_pick.result IS DISTINCT FROM 'win' THEN
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
  AND result_source = 'auto'
  AND result_override_reason IS NULL
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
  AND result_source = 'auto'
  AND result_override_reason IS NULL
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
  AND result_source = 'auto'
  AND result_override_reason IS NULL
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
  AND result_source = 'auto'
  AND result_override_reason IS NULL
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

REVOKE ALL ON FUNCTION public.sync_game_participants(public.games) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_regular_pick_game_and_provenance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_playoff_pick_game_and_provenance() FROM PUBLIC;

COMMENT ON TABLE public.games IS
  'NFL schedule/results synced from a fixed server-side provider (nflverse).';
COMMENT ON FUNCTION public.effective_current_week_id(UUID) IS
  'Lowest regular week with a non-final/canceled game and at least one future kickoff.';
COMMENT ON FUNCTION public.team_regular_game_is_unlocked(INTEGER, INTEGER, UUID) IS
  'True when the team has a scheduled/postponed game with scheduled_kickoff_at > now().';
COMMENT ON FUNCTION public.player_eligible_for_playoff_round(UUID, UUID) IS
  'True when every earlier playoff round is fully final and the player won each prior pick.';
COMMENT ON FUNCTION public.enforce_regular_pick_game_and_provenance() IS
  'Derives game_id and blocks authenticated players from controlling result provenance.';
