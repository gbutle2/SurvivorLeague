"use server";

import { revalidatePath } from "next/cache";

import { mapCommissionerOverrideError } from "@/lib/commissioner/override-errors";
import {
  isCommissioner,
  loadLeagueContext,
} from "@/lib/league/context";
import { createClient } from "@/lib/supabase/server";

export type OverrideActionState = {
  error: string | null;
  success: string | null;
  auditId: string | null;
  targetUserId: string | null;
  result: string | null;
  points: number | null;
  cleared: boolean;
};

const empty: OverrideActionState = {
  error: null,
  success: null,
  auditId: null,
  targetUserId: null,
  result: null,
  points: null,
  cleared: false,
};

const PICKS_PATH = "/commissioner/picks";

export type UsedElsewhere = {
  team_id: string;
  week_number: number;
  abbreviation: string;
};

export type CommissionerWeekPickRow = {
  user_id: string;
  display_name: string;
  pick_id: string | null;
  team_id: string | null;
  team_abbreviation: string | null;
  team_city: string | null;
  team_name: string | null;
  game_id: string | null;
  result: "pending" | "win" | "loss" | "tie" | null;
  points: number;
  submitted_at: string | null;
  updated_at: string | null;
  last_override_at: string | null;
  last_override_reason: string | null;
  last_override_by: string | null;
  used_elsewhere: UsedElsewhere[];
};

export type WeekTeamOption = {
  teamId: string;
  abbreviation: string;
  city: string;
  name: string;
  playsThisWeek: boolean;
  kickoffAt: string | null;
  gameStatus: string | null;
};

export async function loadCommissionerWeekPicks(
  weekId: string,
): Promise<CommissionerWeekPickRow[]> {
  const contextResult = await loadLeagueContext();
  if (!contextResult.ok || !isCommissioner(contextResult.context)) {
    throw new Error("Unauthorized");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("commissioner_list_week_picks", {
    p_week_id: weekId,
  });

  if (error) {
    throw new Error(mapCommissionerOverrideError(error));
  }

  return (data ?? []).map((row) => ({
    user_id: row.user_id,
    display_name: row.display_name,
    pick_id: row.pick_id,
    team_id: row.team_id,
    team_abbreviation: row.team_abbreviation,
    team_city: row.team_city,
    team_name: row.team_name,
    game_id: row.game_id,
    result: row.result,
    points: row.points ?? 0,
    submitted_at: row.submitted_at,
    updated_at: row.updated_at,
    last_override_at: row.last_override_at,
    last_override_reason: row.last_override_reason,
    last_override_by: row.last_override_by,
    used_elsewhere: Array.isArray(row.used_elsewhere)
      ? (row.used_elsewhere as UsedElsewhere[])
      : [],
  }));
}

export async function loadWeekTeamOptions(
  seasonYear: number,
  weekNumber: number,
): Promise<WeekTeamOption[]> {
  const contextResult = await loadLeagueContext();
  if (!contextResult.ok || !isCommissioner(contextResult.context)) {
    throw new Error("Unauthorized");
  }

  const supabase = await createClient();
  const [{ data: teams, error: teamsError }, { data: games, error: gamesError }] =
    await Promise.all([
      supabase
        .from("teams")
        .select("id, abbreviation, city, name")
        .eq("active", true)
        .order("abbreviation"),
      supabase
        .from("games")
        .select(
          "home_team_id, away_team_id, scheduled_kickoff_at, status",
        )
        .eq("season_year", seasonYear)
        .eq("season_type", "regular")
        .eq("regular_week_number", weekNumber)
        .neq("status", "canceled"),
    ]);

  if (teamsError || gamesError) {
    throw new Error("Could not load teams for this week.");
  }

  const byTeam = new Map<
    string,
    { kickoffAt: string; gameStatus: string }
  >();
  for (const game of games ?? []) {
    byTeam.set(game.home_team_id, {
      kickoffAt: game.scheduled_kickoff_at,
      gameStatus: game.status,
    });
    byTeam.set(game.away_team_id, {
      kickoffAt: game.scheduled_kickoff_at,
      gameStatus: game.status,
    });
  }

  return (teams ?? []).map((team) => {
    const schedule = byTeam.get(team.id);
    return {
      teamId: team.id,
      abbreviation: team.abbreviation,
      city: team.city,
      name: team.name,
      playsThisWeek: Boolean(schedule),
      kickoffAt: schedule?.kickoffAt ?? null,
      gameStatus: schedule?.gameStatus ?? null,
    };
  });
}

export async function previewOverride(
  weekId: string,
  teamId: string | null,
): Promise<{
  result: string | null;
  points: number;
  gameStatus: string | null;
  kickoffPassed: boolean;
  error: string | null;
}> {
  const contextResult = await loadLeagueContext();
  if (!contextResult.ok || !isCommissioner(contextResult.context)) {
    return {
      result: null,
      points: 0,
      gameStatus: null,
      kickoffPassed: false,
      error: "Unauthorized",
    };
  }

  if (!teamId) {
    return {
      result: null,
      points: 0,
      gameStatus: null,
      kickoffPassed: false,
      error: null,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "commissioner_preview_pick_override",
    {
      p_week_id: weekId,
      p_team_id: teamId,
    },
  );

  if (error) {
    return {
      result: null,
      points: 0,
      gameStatus: null,
      kickoffPassed: false,
      error: mapCommissionerOverrideError(error),
    };
  }

  const payload = data as {
    result?: string | null;
    points?: number;
    game_status?: string | null;
    kickoff_passed?: boolean;
  } | null;

  return {
    result: payload?.result ?? null,
    points: payload?.points ?? 0,
    gameStatus: payload?.game_status ?? null,
    kickoffPassed: Boolean(payload?.kickoff_passed),
    error: null,
  };
}

export async function commissionerOverridePick(
  _prev: OverrideActionState,
  formData: FormData,
): Promise<OverrideActionState> {
  const contextResult = await loadLeagueContext();
  if (!contextResult.ok) {
    return { ...empty, error: contextResult.message };
  }
  if (!isCommissioner(contextResult.context)) {
    return { ...empty, error: "Only the league commissioner can override picks." };
  }

  // Submitted identity/scoring fields are intentionally ignored.
  void formData.get("requester_id");
  void formData.get("league_id");
  void formData.get("role");
  void formData.get("result");
  void formData.get("points");
  void formData.get("game_id");

  const targetUserId = String(formData.get("target_user_id") ?? "").trim();
  const weekId = String(formData.get("week_id") ?? "").trim();
  const teamRaw = String(formData.get("team_id") ?? "").trim();
  const teamId = teamRaw === "" || teamRaw === "__none__" ? null : teamRaw;
  const reason = String(formData.get("reason") ?? "").trim();
  const confirmed = String(formData.get("confirmed") ?? "") === "1";
  const clear = String(formData.get("clear") ?? "") === "1";

  if (!targetUserId || !weekId) {
    return { ...empty, error: "Missing player or week." };
  }
  if (!reason) {
    return { ...empty, error: "Enter a reason for this override." };
  }
  if (!confirmed) {
    return { ...empty, error: "Confirm the override before saving." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("commissioner_override_pick", {
    p_target_user_id: targetUserId,
    p_week_id: weekId,
    p_team_id: clear ? null : teamId,
    p_reason: reason,
  });

  if (error) {
    return { ...empty, error: mapCommissionerOverrideError(error), targetUserId };
  }

  const payload = data as {
    audit_id?: string;
    cleared?: boolean;
    result?: string | null;
    points?: number;
  } | null;

  if (!payload?.audit_id) {
    return {
      ...empty,
      error: "Override did not complete. No audit confirmation was returned.",
      targetUserId,
    };
  }

  revalidatePath(PICKS_PATH);
  revalidatePath("/");
  revalidatePath("/pick");
  revalidatePath("/availability");
  revalidatePath("/history");

  return {
    error: null,
    success: payload.cleared
      ? "Pick cleared. Standings will reflect a missed pick."
      : "Override saved.",
    auditId: payload.audit_id,
    targetUserId,
    result: payload.result ?? null,
    points: payload.points ?? 0,
    cleared: Boolean(payload.cleared),
  };
}
