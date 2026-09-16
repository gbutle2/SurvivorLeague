-- Row Level Security policies for Sunday Survivor Picks.
-- Membership checks use SECURITY DEFINER helpers to avoid recursive RLS.

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weeks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playoff_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.playoff_picks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scoring_rules ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
CREATE POLICY profiles_select_self_or_league_mates
ON public.profiles
FOR SELECT
TO authenticated
USING (
  id = auth.uid()
  OR public.shares_league_with(id)
);

CREATE POLICY profiles_update_own
ON public.profiles
FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- leagues
-- ---------------------------------------------------------------------------
CREATE POLICY leagues_select_members
ON public.leagues
FOR SELECT
TO authenticated
USING (public.is_active_league_member(id));

CREATE POLICY leagues_update_commissioner
ON public.leagues
FOR UPDATE
TO authenticated
USING (public.is_league_commissioner(id))
WITH CHECK (public.is_league_commissioner(id));

-- League rows are created during documented commissioner setup (SQL / service role).

-- ---------------------------------------------------------------------------
-- league_members
-- ---------------------------------------------------------------------------
CREATE POLICY league_members_select_peers
ON public.league_members
FOR SELECT
TO authenticated
USING (public.is_active_league_member(league_id));

CREATE POLICY league_members_insert_commissioner
ON public.league_members
FOR INSERT
TO authenticated
WITH CHECK (public.is_league_commissioner(league_id));

CREATE POLICY league_members_update_commissioner
ON public.league_members
FOR UPDATE
TO authenticated
USING (public.is_league_commissioner(league_id))
WITH CHECK (public.is_league_commissioner(league_id));

CREATE POLICY league_members_delete_commissioner
ON public.league_members
FOR DELETE
TO authenticated
USING (public.is_league_commissioner(league_id));

-- ---------------------------------------------------------------------------
-- seasons
-- ---------------------------------------------------------------------------
CREATE POLICY seasons_select_members
ON public.seasons
FOR SELECT
TO authenticated
USING (public.is_active_league_member(league_id));

CREATE POLICY seasons_insert_commissioner
ON public.seasons
FOR INSERT
TO authenticated
WITH CHECK (public.is_league_commissioner(league_id));

CREATE POLICY seasons_update_commissioner
ON public.seasons
FOR UPDATE
TO authenticated
USING (public.is_league_commissioner(league_id))
WITH CHECK (public.is_league_commissioner(league_id));

CREATE POLICY seasons_delete_commissioner
ON public.seasons
FOR DELETE
TO authenticated
USING (public.is_league_commissioner(league_id));

-- ---------------------------------------------------------------------------
-- teams (global reference data for active league members)
-- ---------------------------------------------------------------------------
CREATE POLICY teams_select_members
ON public.teams
FOR SELECT
TO authenticated
USING (public.is_active_member_of_any_league());

CREATE POLICY teams_manage_commissioner_any
ON public.teams
FOR ALL
TO authenticated
USING (public.is_any_league_commissioner())
WITH CHECK (public.is_any_league_commissioner());

-- ---------------------------------------------------------------------------
-- weeks
-- ---------------------------------------------------------------------------
CREATE POLICY weeks_select_members
ON public.weeks
FOR SELECT
TO authenticated
USING (
  public.is_active_league_member(public.league_id_for_season(season_id))
);

CREATE POLICY weeks_insert_commissioner
ON public.weeks
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_league_commissioner(public.league_id_for_season(season_id))
);

CREATE POLICY weeks_update_commissioner
ON public.weeks
FOR UPDATE
TO authenticated
USING (
  public.is_league_commissioner(public.league_id_for_season(season_id))
)
WITH CHECK (
  public.is_league_commissioner(public.league_id_for_season(season_id))
);

CREATE POLICY weeks_delete_commissioner
ON public.weeks
FOR DELETE
TO authenticated
USING (
  public.is_league_commissioner(public.league_id_for_season(season_id))
);

-- ---------------------------------------------------------------------------
-- picks
-- Before locks_at: only the owning player can read their pick.
-- After locks_at: all active league members can read that week's picks.
-- Players insert/update only their own picks before lock.
-- Commissioners can update results (enforced further by trigger).
-- ---------------------------------------------------------------------------
CREATE POLICY picks_select_own_or_locked_week
ON public.picks
FOR SELECT
TO authenticated
USING (
  public.is_active_league_member(public.league_id_for_week(week_id))
  AND (
    user_id = auth.uid()
    OR public.week_is_locked(week_id)
  )
);

CREATE POLICY picks_insert_own_before_lock
ON public.picks
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND public.is_active_league_member(public.league_id_for_week(week_id))
  AND public.week_is_unlocked(week_id)
);

CREATE POLICY picks_update_own_before_lock
ON public.picks
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND public.week_is_unlocked(week_id)
)
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND public.week_is_unlocked(week_id)
);

CREATE POLICY picks_update_commissioner
ON public.picks
FOR UPDATE
TO authenticated
USING (
  public.is_league_commissioner(public.league_id_for_week(week_id))
)
WITH CHECK (
  public.is_league_commissioner(public.league_id_for_week(week_id))
);

CREATE POLICY picks_delete_commissioner
ON public.picks
FOR DELETE
TO authenticated
USING (
  public.is_league_commissioner(public.league_id_for_week(week_id))
);

-- ---------------------------------------------------------------------------
-- playoff_rounds
-- ---------------------------------------------------------------------------
CREATE POLICY playoff_rounds_select_members
ON public.playoff_rounds
FOR SELECT
TO authenticated
USING (
  public.is_active_league_member(public.league_id_for_season(season_id))
);

CREATE POLICY playoff_rounds_insert_commissioner
ON public.playoff_rounds
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_league_commissioner(public.league_id_for_season(season_id))
);

CREATE POLICY playoff_rounds_update_commissioner
ON public.playoff_rounds
FOR UPDATE
TO authenticated
USING (
  public.is_league_commissioner(public.league_id_for_season(season_id))
)
WITH CHECK (
  public.is_league_commissioner(public.league_id_for_season(season_id))
);

CREATE POLICY playoff_rounds_delete_commissioner
ON public.playoff_rounds
FOR DELETE
TO authenticated
USING (
  public.is_league_commissioner(public.league_id_for_season(season_id))
);

-- ---------------------------------------------------------------------------
-- playoff_picks
-- ---------------------------------------------------------------------------
CREATE POLICY playoff_picks_select_own_or_locked_round
ON public.playoff_picks
FOR SELECT
TO authenticated
USING (
  public.is_active_league_member(
    public.league_id_for_playoff_round(playoff_round_id)
  )
  AND (
    user_id = auth.uid()
    OR public.playoff_round_is_locked(playoff_round_id)
  )
);

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
  AND public.playoff_round_is_unlocked(playoff_round_id)
);

CREATE POLICY playoff_picks_update_own_before_lock
ON public.playoff_picks
FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND public.playoff_round_is_unlocked(playoff_round_id)
)
WITH CHECK (
  user_id = auth.uid()
  AND result = 'pending'
  AND points_awarded = 0
  AND public.playoff_round_is_unlocked(playoff_round_id)
);

CREATE POLICY playoff_picks_update_commissioner
ON public.playoff_picks
FOR UPDATE
TO authenticated
USING (
  public.is_league_commissioner(
    public.league_id_for_playoff_round(playoff_round_id)
  )
)
WITH CHECK (
  public.is_league_commissioner(
    public.league_id_for_playoff_round(playoff_round_id)
  )
);

CREATE POLICY playoff_picks_delete_commissioner
ON public.playoff_picks
FOR DELETE
TO authenticated
USING (
  public.is_league_commissioner(
    public.league_id_for_playoff_round(playoff_round_id)
  )
);

-- ---------------------------------------------------------------------------
-- scoring_rules
-- ---------------------------------------------------------------------------
CREATE POLICY scoring_rules_select_members
ON public.scoring_rules
FOR SELECT
TO authenticated
USING (
  public.is_active_league_member(public.league_id_for_season(season_id))
);

CREATE POLICY scoring_rules_insert_commissioner
ON public.scoring_rules
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_league_commissioner(public.league_id_for_season(season_id))
);

CREATE POLICY scoring_rules_update_commissioner
ON public.scoring_rules
FOR UPDATE
TO authenticated
USING (
  public.is_league_commissioner(public.league_id_for_season(season_id))
)
WITH CHECK (
  public.is_league_commissioner(public.league_id_for_season(season_id))
);

CREATE POLICY scoring_rules_delete_commissioner
ON public.scoring_rules
FOR DELETE
TO authenticated
USING (
  public.is_league_commissioner(public.league_id_for_season(season_id))
);
