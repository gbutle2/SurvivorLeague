"use server";

import { revalidatePath } from "next/cache";

import { authenticatedUserId } from "@/lib/auth/identity";
import { loadLeagueContext } from "@/lib/league/context";
import {
  PICK_INSERT_ZERO_ROW,
  PICK_UPDATE_ZERO_ROW,
  requireMutationRow,
} from "@/lib/mutations/result";
import { loadRegularWeekSignals } from "@/lib/nfl/schedule-query";
import { mapPickMutationError } from "@/lib/picks/errors";
import { setupSeasonBlocksPicks } from "@/lib/season/activation";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentWeekFromGames } from "@/lib/weeks/current-week";

export type PickActionState = {
  error: string | null;
  success: string | null;
  savedTeamId: string | null;
  savedTeamLabel: string | null;
};

/**
 * Save or change the authenticated player's pick for the effective current week.
 * Identity always comes from the session. Database RLS enforces kickoff locks.
 */
export async function savePick(
  _prev: PickActionState,
  formData: FormData,
): Promise<PickActionState> {
  const empty: PickActionState = {
    error: null,
    success: null,
    savedTeamId: null,
    savedTeamLabel: null,
  };

  const contextResult = await loadLeagueContext();
  if (!contextResult.ok) {
    return { ...empty, error: contextResult.message };
  }

  const { context } = contextResult;
  if (setupSeasonBlocksPicks(context.season.status)) {
    return {
      ...empty,
      error:
        "The season is still in setup. Picks open after the commissioner activates the season.",
    };
  }

  const userId = authenticatedUserId(
    context.userId,
    String(formData.get("user_id") ?? "") || null,
  );
  const teamId = String(formData.get("team_id") ?? "").trim();
  if (!teamId) {
    return { ...empty, error: "Select a team before saving." };
  }

  const supabase = await createClient();

  const { data: weeks, error: weeksError } = await supabase
    .from("weeks")
    .select("id, week_number, label, locks_at, status")
    .eq("season_id", context.season.id);

  if (weeksError) {
    return { ...empty, error: "Database unavailable. Could not load weeks." };
  }

  const { signals, error: signalError } = await loadRegularWeekSignals(
    supabase as never,
    context.season.year,
  );
  if (signalError) {
    return { ...empty, error: "Could not load NFL schedule." };
  }

  const current = resolveCurrentWeekFromGames(weeks ?? [], signals);
  if (current.kind !== "actionable" || !current.picksAllowed) {
    return {
      ...empty,
      error: "No NFL week is available for picks right now.",
    };
  }

  const week = current.week;

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("id, abbreviation, city, name, active")
    .eq("id", teamId)
    .eq("active", true)
    .maybeSingle();

  if (teamError || !team) {
    return { ...empty, error: "That team is not available." };
  }

  const { data: game } = await supabase
    .from("games")
    .select("id, scheduled_kickoff_at, status, home_team_id, away_team_id")
    .eq("season_year", context.season.year)
    .eq("season_type", "regular")
    .eq("regular_week_number", week.week_number)
    .neq("status", "canceled")
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .maybeSingle();

  if (!game) {
    return {
      ...empty,
      error: "That team is on bye or not scheduled this NFL week.",
    };
  }

  const teamLabel = `${team.city} ${team.name} (${team.abbreviation})`;

  const { data: existingPick, error: existingError } = await supabase
    .from("picks")
    .select("id, team_id")
    .eq("week_id", week.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    return { ...empty, error: "Database unavailable. Could not load your pick." };
  }

  if (existingPick) {
    const { data: updated, error } = await supabase
      .from("picks")
      .update({ team_id: teamId })
      .eq("id", existingPick.id)
      .eq("user_id", userId)
      .select("id, team_id")
      .maybeSingle();

    if (error) {
      return { ...empty, error: mapPickMutationError(error) };
    }
    const confirmed = requireMutationRow(updated, PICK_UPDATE_ZERO_ROW);
    if (!confirmed.ok) {
      return { ...empty, error: confirmed.error };
    }

    revalidatePath("/pick");
    revalidatePath("/");
    revalidatePath("/availability");
    return {
      error: null,
      success: `Saved ${teamLabel} for ${week.label}.`,
      savedTeamId: teamId,
      savedTeamLabel: teamLabel,
    };
  }

  const { data: inserted, error } = await supabase
    .from("picks")
    .insert({
      week_id: week.id,
      user_id: userId,
      team_id: teamId,
      result: "pending",
    })
    .select("id, team_id")
    .maybeSingle();

  if (error) {
    return { ...empty, error: mapPickMutationError(error) };
  }
  const confirmed = requireMutationRow(inserted, PICK_INSERT_ZERO_ROW);
  if (!confirmed.ok) {
    return { ...empty, error: confirmed.error };
  }

  revalidatePath("/pick");
  revalidatePath("/");
  revalidatePath("/availability");
  return {
    error: null,
    success: `Saved ${teamLabel} for ${week.label}.`,
    savedTeamId: teamId,
    savedTeamLabel: teamLabel,
  };
}
