"use server";

import { revalidatePath } from "next/cache";

import { authenticatedUserId } from "@/lib/auth/identity";
import { loadLeagueContext } from "@/lib/league/context";
import {
  PICK_INSERT_ZERO_ROW,
  PICK_UPDATE_ZERO_ROW,
  requireMutationRow,
} from "@/lib/mutations/result";
import { mapPickMutationError } from "@/lib/picks/errors";
import { setupSeasonBlocksPicks } from "@/lib/season/activation";
import { createClient } from "@/lib/supabase/server";
import { resolveCurrentWeek } from "@/lib/weeks/current-week";

export type PickActionState = {
  error: string | null;
  success: string | null;
  savedTeamId: string | null;
  savedTeamLabel: string | null;
};

/**
 * Save or change the authenticated player's pick for the effective current week.
 * Identity always comes from the session — never from submitted user_id.
 * Database RLS remains authoritative for eligibility.
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

  const current = resolveCurrentWeek(weeks ?? []);
  if (current.kind !== "actionable" || !current.picksAllowed) {
    return {
      ...empty,
      error: "No week is available for picks right now.",
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
    if (existingPick.team_id === teamId) {
      return {
        error: null,
        success: `Pick already saved: ${teamLabel}.`,
        savedTeamId: teamId,
        savedTeamLabel: teamLabel,
      };
    }

    const { data, error } = await supabase
      .from("picks")
      .update({ team_id: teamId })
      .eq("id", existingPick.id)
      .eq("user_id", userId)
      .eq("week_id", week.id)
      .select("id, team_id")
      .maybeSingle();

    if (error) {
      return { ...empty, error: mapPickMutationError(error) };
    }
    const confirmed = requireMutationRow(data, PICK_UPDATE_ZERO_ROW);
    if (!confirmed.ok) {
      return { ...empty, error: confirmed.error };
    }
  } else {
    const { data, error } = await supabase
      .from("picks")
      .insert({
        week_id: week.id,
        user_id: userId,
        team_id: teamId,
      })
      .select("id, team_id")
      .maybeSingle();

    if (error) {
      return { ...empty, error: mapPickMutationError(error) };
    }
    const confirmed = requireMutationRow(data, PICK_INSERT_ZERO_ROW);
    if (!confirmed.ok) {
      return { ...empty, error: confirmed.error };
    }
  }

  revalidatePath("/pick");
  revalidatePath("/availability");
  revalidatePath("/history");
  revalidatePath("/");

  return {
    error: null,
    success: `Saved ${teamLabel} for Week ${week.week_number}.`,
    savedTeamId: teamId,
    savedTeamLabel: teamLabel,
  };
}
