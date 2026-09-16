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
import { isLockedAt } from "@/lib/time/chicago";
import { resolveOpenWeek } from "@/lib/weeks/open-week";

export type PickActionState = {
  error: string | null;
  success: string | null;
  savedTeamId: string | null;
  savedTeamLabel: string | null;
};

/**
 * Save or change the authenticated player's pick for the single open week.
 * Identity always comes from the session — never from submitted user_id.
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

  const open = resolveOpenWeek(weeks ?? []);
  if (open.kind === "none") {
    return {
      ...empty,
      error: "No week is open for picks right now.",
    };
  }
  if (open.kind === "multiple") {
    return {
      ...empty,
      error:
        "Multiple weeks are marked open. Ask the commissioner to fix week configuration.",
    };
  }

  const week = open.week;
  if (isLockedAt(week.locks_at)) {
    return {
      ...empty,
      error: "This week is locked. Picks can no longer be changed.",
    };
  }

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

  const { data: existing, error: existingError } = await supabase
    .from("picks")
    .select("id, team_id")
    .eq("week_id", week.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (existingError) {
    return { ...empty, error: mapPickMutationError(existingError) };
  }

  if (existing) {
    if (existing.team_id === teamId) {
      return {
        error: null,
        success: `Pick already saved: ${teamLabel}.`,
        savedTeamId: teamId,
        savedTeamLabel: teamLabel,
      };
    }

    const { data, error: updateError } = await supabase
      .from("picks")
      .update({ team_id: teamId })
      .eq("id", existing.id)
      .eq("user_id", userId)
      .eq("week_id", week.id)
      .select("id, team_id")
      .maybeSingle();

    if (updateError) {
      return { ...empty, error: mapPickMutationError(updateError) };
    }

    const confirmed = requireMutationRow(data, PICK_UPDATE_ZERO_ROW);
    if (!confirmed.ok) {
      return { ...empty, error: confirmed.error };
    }
  } else {
    const { data, error: insertError } = await supabase
      .from("picks")
      .insert({
        week_id: week.id,
        user_id: userId,
        team_id: teamId,
      })
      .select("id, team_id")
      .maybeSingle();

    if (insertError) {
      return { ...empty, error: mapPickMutationError(insertError) };
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
    success: `Saved pick: ${teamLabel}.`,
    savedTeamId: teamId,
    savedTeamLabel: teamLabel,
  };
}
