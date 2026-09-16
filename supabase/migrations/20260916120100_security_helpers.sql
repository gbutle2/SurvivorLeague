-- SECURITY DEFINER helpers used by RLS.
-- These bypass RLS on league_members so policies do not recurse.

CREATE OR REPLACE FUNCTION public.is_active_league_member(p_league_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.league_members lm
    WHERE lm.league_id = p_league_id
      AND lm.user_id = auth.uid()
      AND lm.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_league_commissioner(p_league_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.league_members lm
    WHERE lm.league_id = p_league_id
      AND lm.user_id = auth.uid()
      AND lm.role = 'commissioner'
      AND lm.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.shares_league_with(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.league_members self_m
    INNER JOIN public.league_members other_m
      ON other_m.league_id = self_m.league_id
    WHERE self_m.user_id = auth.uid()
      AND other_m.user_id = p_user_id
      AND self_m.active = true
      AND other_m.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_member_of_any_league()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.league_members lm
    WHERE lm.user_id = auth.uid()
      AND lm.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_any_league_commissioner()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.league_members lm
    WHERE lm.user_id = auth.uid()
      AND lm.role = 'commissioner'
      AND lm.active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.league_id_for_season(p_season_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.league_id
  FROM public.seasons s
  WHERE s.id = p_season_id;
$$;

CREATE OR REPLACE FUNCTION public.league_id_for_week(p_week_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.league_id
  FROM public.weeks w
  INNER JOIN public.seasons s ON s.id = w.season_id
  WHERE w.id = p_week_id;
$$;

CREATE OR REPLACE FUNCTION public.league_id_for_playoff_round(p_playoff_round_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.league_id
  FROM public.playoff_rounds pr
  INNER JOIN public.seasons s ON s.id = pr.season_id
  WHERE pr.id = p_playoff_round_id;
$$;

CREATE OR REPLACE FUNCTION public.week_is_unlocked(p_week_id UUID)
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
      AND w.locks_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.week_is_locked(p_week_id UUID)
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
      AND w.locks_at <= now()
  );
$$;

CREATE OR REPLACE FUNCTION public.playoff_round_is_unlocked(p_playoff_round_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.playoff_rounds pr
    WHERE pr.id = p_playoff_round_id
      AND pr.locks_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.playoff_round_is_locked(p_playoff_round_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.playoff_rounds pr
    WHERE pr.id = p_playoff_round_id
      AND pr.locks_at <= now()
  );
$$;

CREATE OR REPLACE FUNCTION public.enforce_unique_team_per_season()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_season_id UUID;
BEGIN
  SELECT w.season_id INTO v_season_id
  FROM public.weeks w
  WHERE w.id = NEW.week_id;

  IF EXISTS (
    SELECT 1
    FROM public.picks p
    INNER JOIN public.weeks w ON w.id = p.week_id
    WHERE p.user_id = NEW.user_id
      AND p.team_id = NEW.team_id
      AND w.season_id = v_season_id
      AND p.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'Team already used by this player in the same season'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER picks_enforce_unique_team_per_season
BEFORE INSERT OR UPDATE OF team_id, week_id, user_id
ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_unique_team_per_season();

-- Players may not change pick results; commissioners may.
CREATE OR REPLACE FUNCTION public.enforce_regular_pick_result_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.result IS DISTINCT FROM OLD.result
     AND NOT public.is_league_commissioner(public.league_id_for_week(NEW.week_id)) THEN
    RAISE EXCEPTION 'Only commissioners can set pick results'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_playoff_pick_result_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF (
       NEW.result IS DISTINCT FROM OLD.result
       OR NEW.points_awarded IS DISTINCT FROM OLD.points_awarded
     )
     AND NOT public.is_league_commissioner(
       public.league_id_for_playoff_round(NEW.playoff_round_id)
     ) THEN
    RAISE EXCEPTION 'Only commissioners can set pick results'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER picks_enforce_result_permissions
BEFORE UPDATE ON public.picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_regular_pick_result_permissions();

CREATE TRIGGER playoff_picks_enforce_result_permissions
BEFORE UPDATE ON public.playoff_picks
FOR EACH ROW
EXECUTE FUNCTION public.enforce_playoff_pick_result_permissions();
-- Prevent self-promotion to commissioner via membership updates.
-- auth.uid() IS NULL allows SQL editor / service-role bootstrap.
CREATE OR REPLACE FUNCTION public.enforce_membership_role_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.role IS DISTINCT FROM OLD.role
     AND NEW.role = 'commissioner'
     AND (
       NEW.user_id = auth.uid()
       OR NOT public.is_league_commissioner(NEW.league_id)
     ) THEN
    RAISE EXCEPTION 'Users cannot promote themselves to commissioner'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT'
     AND NEW.role = 'commissioner'
     AND NOT public.is_league_commissioner(NEW.league_id) THEN
    RAISE EXCEPTION 'Only existing commissioners can grant commissioner role'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER league_members_enforce_role_changes
BEFORE INSERT OR UPDATE ON public.league_members
FOR EACH ROW
EXECUTE FUNCTION public.enforce_membership_role_changes();

REVOKE ALL ON FUNCTION public.is_active_league_member(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_league_commissioner(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.shares_league_with(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_member_of_any_league() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_any_league_commissioner() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.league_id_for_season(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.league_id_for_week(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.league_id_for_playoff_round(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.week_is_unlocked(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.week_is_locked(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.playoff_round_is_unlocked(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.playoff_round_is_locked(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_active_league_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_league_commissioner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_league_with(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_member_of_any_league() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_any_league_commissioner() TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_id_for_season(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_id_for_week(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.league_id_for_playoff_round(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.week_is_unlocked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.week_is_locked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.playoff_round_is_unlocked(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.playoff_round_is_locked(UUID) TO authenticated;
