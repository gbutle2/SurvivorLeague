import type {
  MemberRole,
  SeasonStatus,
  WeekStatus,
} from "@/lib/database.types";
import { createClient } from "@/lib/supabase/server";
import { LEAGUE_TIMEZONE } from "@/lib/time/chicago";

export type ScoringRulesSummary = {
  seasonId: string;
  correctRegularPickPoints: number;
  bestRecordBonus: number;
  longestStreakBonus: number;
  survivorBonus: number;
  wildcardPoints: number;
  divisionalPoints: number;
  conferencePoints: number;
  superbowlPoints: number;
  perfectSeasonOverride: boolean;
};

export type LeagueContext = {
  userId: string;
  email: string | null;
  displayName: string;
  membership: {
    leagueId: string;
    role: MemberRole;
    active: boolean;
  };
  league: {
    id: string;
    name: string;
    slug: string;
    timezone: string;
  };
  season: {
    id: string;
    year: number;
    status: SeasonStatus;
    regularWeekCount: number;
    seasonComplete: boolean;
  };
  scoringRules: ScoringRulesSummary | null;
};

export type LeagueContextErrorCode =
  | "unauthenticated"
  | "no_membership"
  | "multiple_memberships"
  | "no_season"
  | "multiple_seasons"
  | "database_error";

export type LeagueContextResult =
  | { ok: true; context: LeagueContext }
  | { ok: false; code: LeagueContextErrorCode; message: string };

type MembershipRow = {
  league_id: string;
  role: MemberRole;
  active: boolean;
};

/**
 * Central server-side loader for the authenticated player's active league.
 * Fails explicitly when membership or season selection would be ambiguous.
 */
export async function loadLeagueContext(): Promise<LeagueContextResult> {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return {
      ok: false,
      code: "database_error",
      message: "Database unavailable. Try again shortly.",
    };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    return {
      ok: false,
      code: "database_error",
      message: "Could not verify your session. Try signing in again.",
    };
  }

  if (!user) {
    return {
      ok: false,
      code: "unauthenticated",
      message: "Sign in to continue.",
    };
  }

  const { data: memberships, error: membershipError } = await supabase
    .from("league_members")
    .select("league_id, role, active")
    .eq("user_id", user.id)
    .eq("active", true);

  if (membershipError) {
    return {
      ok: false,
      code: "database_error",
      message: "Database unavailable. Could not load league membership.",
    };
  }

  const rows = (memberships ?? []) as MembershipRow[];

  if (rows.length === 0) {
    return {
      ok: false,
      code: "no_membership",
      message:
        "You are signed in, but you are not an active member of a league yet.",
    };
  }

  if (rows.length > 1) {
    return {
      ok: false,
      code: "multiple_memberships",
      message:
        "You belong to more than one active league. Ask the commissioner to resolve membership before continuing.",
    };
  }

  const membership = rows[0]!;

  const { data: league, error: leagueError } = await supabase
    .from("leagues")
    .select("id, name, slug, timezone")
    .eq("id", membership.league_id)
    .maybeSingle();

  if (leagueError) {
    return {
      ok: false,
      code: "database_error",
      message: "Database unavailable. Could not load league details.",
    };
  }

  if (!league) {
    return {
      ok: false,
      code: "database_error",
      message: "League details could not be loaded.",
    };
  }

  const { data: seasons, error: seasonError } = await supabase
    .from("seasons")
    .select(
      "id, year, status, regular_week_count, season_complete",
    )
    .eq("league_id", league.id)
    .in("status", ["setup", "active"]);

  if (seasonError) {
    return {
      ok: false,
      code: "database_error",
      message: "Database unavailable. Could not load the season.",
    };
  }

  const seasonRows = seasons ?? [];

  if (seasonRows.length === 0) {
    return {
      ok: false,
      code: "no_season",
      message:
        "No season is in setup or active yet. The commissioner needs to create one.",
    };
  }

  if (seasonRows.length > 1) {
    return {
      ok: false,
      code: "multiple_seasons",
      message:
        "More than one setup/active season exists. Ask the commissioner to leave only one current season.",
    };
  }

  const season = seasonRows[0]!;

  const { data: scoring, error: scoringError } = await supabase
    .from("scoring_rules")
    .select(
      "season_id, correct_regular_pick_points, best_record_bonus, longest_streak_bonus, survivor_bonus, wildcard_points, divisional_points, conference_points, superbowl_points, perfect_season_override",
    )
    .eq("season_id", season.id)
    .maybeSingle();

  if (scoringError) {
    return {
      ok: false,
      code: "database_error",
      message: "Database unavailable. Could not load scoring rules.",
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  return {
    ok: true,
    context: {
      userId: user.id,
      email: user.email ?? null,
      displayName:
        profile?.display_name ??
        user.user_metadata?.display_name ??
        user.email?.split("@")[0] ??
        "Player",
      membership: {
        leagueId: membership.league_id,
        role: membership.role,
        active: membership.active,
      },
      league: {
        id: league.id,
        name: league.name,
        slug: league.slug,
        timezone: league.timezone || LEAGUE_TIMEZONE,
      },
      season: {
        id: season.id,
        year: season.year,
        status: season.status,
        regularWeekCount: season.regular_week_count,
        seasonComplete: season.season_complete,
      },
      scoringRules: scoring
        ? {
            seasonId: scoring.season_id,
            correctRegularPickPoints: scoring.correct_regular_pick_points,
            bestRecordBonus: scoring.best_record_bonus,
            longestStreakBonus: scoring.longest_streak_bonus,
            survivorBonus: scoring.survivor_bonus,
            wildcardPoints: scoring.wildcard_points,
            divisionalPoints: scoring.divisional_points,
            conferencePoints: scoring.conference_points,
            superbowlPoints: scoring.superbowl_points,
            perfectSeasonOverride: scoring.perfect_season_override,
          }
        : null,
    },
  };
}

export function isCommissioner(context: LeagueContext): boolean {
  return context.membership.role === "commissioner";
}

export type WeekRow = {
  id: string;
  season_id: string;
  week_number: number;
  label: string;
  locks_at: string;
  status: WeekStatus;
};
