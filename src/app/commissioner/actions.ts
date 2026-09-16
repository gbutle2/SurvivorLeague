"use server";

import { revalidatePath } from "next/cache";

import { commissionerActionDenied } from "@/lib/auth/identity";
import {
  loadLeagueContext,
  type WeekRow,
} from "@/lib/league/context";
import type { WeekStatus } from "@/lib/database.types";
import {
  COMMISSIONER_UPDATE_ZERO_ROW,
  requireMutationRow,
  SEASON_ACTIVATION_ZERO_ROW,
} from "@/lib/mutations/result";
import { mapWeekMutationError } from "@/lib/picks/errors";
import {
  activationBlockedReason,
  interpretSeasonActivationRow,
} from "@/lib/season/activation";
import { createClient } from "@/lib/supabase/server";
import { chicagoWallTimeToUtcIso } from "@/lib/time/chicago";
import {
  assertFutureDeadline,
  canEditWeekDetails,
  canTransitionWeekStatus,
  CREATE_WEEK_STATUS,
} from "@/lib/weeks/lifecycle";
import { isValidRegularWeekNumber } from "@/lib/weeks/open-week";

export type WeekActionState = {
  error: string | null;
  success: string | null;
};

const initialHelpers = {
  error: null,
  success: null,
} satisfies WeekActionState;

async function requireCommissionerContext() {
  const result = await loadLeagueContext();
  if (!result.ok) {
    return { ok: false as const, error: result.message };
  }
  const denied = commissionerActionDenied(result.context.membership.role);
  if (denied) {
    return { ok: false as const, error: denied };
  }
  return { ok: true as const, context: result.context };
}

function revalidateLeaguePaths() {
  revalidatePath("/commissioner");
  revalidatePath("/pick");
  revalidatePath("/availability");
  revalidatePath("/history");
  revalidatePath("/");
}

export async function createWeek(
  _prev: WeekActionState,
  formData: FormData,
): Promise<WeekActionState> {
  const auth = await requireCommissionerContext();
  if (!auth.ok) {
    return { ...initialHelpers, error: auth.error };
  }

  const weekNumber = Number(String(formData.get("week_number") ?? ""));
  const label = String(formData.get("label") ?? "").trim();
  const lockDate = String(formData.get("lock_date") ?? "").trim();
  const lockTime = String(formData.get("lock_time") ?? "").trim();

  if (!isValidRegularWeekNumber(weekNumber)) {
    return {
      ...initialHelpers,
      error: "Week number must be an integer from 1 to 17.",
    };
  }
  if (!label) {
    return { ...initialHelpers, error: "Label is required." };
  }

  let locksAt: string;
  try {
    locksAt = chicagoWallTimeToUtcIso(lockDate, lockTime);
  } catch (error) {
    return {
      ...initialHelpers,
      error:
        error instanceof Error
          ? error.message
          : "Enter a valid Central Time lock date and time.",
    };
  }

  const futureError = assertFutureDeadline(locksAt);
  if (futureError) {
    return { ...initialHelpers, error: futureError };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weeks")
    .insert({
      season_id: auth.context.season.id,
      week_number: weekNumber,
      label,
      locks_at: locksAt,
      status: CREATE_WEEK_STATUS,
    })
    .select("id, week_number, status")
    .maybeSingle();

  if (error) {
    return { ...initialHelpers, error: mapWeekMutationError(error) };
  }

  const confirmed = requireMutationRow(
    data,
    "The week was not created. Refresh and try again.",
  );
  if (!confirmed.ok) {
    return { ...initialHelpers, error: confirmed.error };
  }

  revalidateLeaguePaths();
  return {
    error: null,
    success: `Week ${confirmed.row.week_number} created as upcoming.`,
  };
}

export async function updateWeek(
  _prev: WeekActionState,
  formData: FormData,
): Promise<WeekActionState> {
  const auth = await requireCommissionerContext();
  if (!auth.ok) {
    return { ...initialHelpers, error: auth.error };
  }

  const weekId = String(formData.get("week_id") ?? "").trim();
  const label = String(formData.get("label") ?? "").trim();
  const lockDate = String(formData.get("lock_date") ?? "").trim();
  const lockTime = String(formData.get("lock_time") ?? "").trim();

  if (!weekId) {
    return { ...initialHelpers, error: "Missing week id." };
  }
  if (!label) {
    return { ...initialHelpers, error: "Label is required." };
  }

  let locksAt: string;
  try {
    locksAt = chicagoWallTimeToUtcIso(lockDate, lockTime);
  } catch (error) {
    return {
      ...initialHelpers,
      error:
        error instanceof Error
          ? error.message
          : "Enter a valid Central Time lock date and time.",
    };
  }

  const futureError = assertFutureDeadline(locksAt);
  if (futureError) {
    return { ...initialHelpers, error: futureError };
  }

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("weeks")
    .select("id, season_id, week_number, label, locks_at, status")
    .eq("id", weekId)
    .eq("season_id", auth.context.season.id)
    .maybeSingle();

  if (loadError || !existing) {
    return {
      ...initialHelpers,
      error: loadError
        ? mapWeekMutationError(loadError)
        : "Week not found for this season.",
    };
  }

  const editBlocked = canEditWeekDetails({
    status: existing.status,
    locksAt: existing.locks_at,
  });
  if (editBlocked) {
    return { ...initialHelpers, error: editBlocked };
  }

  const { data, error } = await supabase
    .from("weeks")
    .update({
      label,
      locks_at: locksAt,
    })
    .eq("id", weekId)
    .eq("season_id", auth.context.season.id)
    .in("status", ["upcoming", "open"])
    .select("id, week_number, label, locks_at, status")
    .maybeSingle();

  if (error) {
    return { ...initialHelpers, error: mapWeekMutationError(error) };
  }

  const confirmed = requireMutationRow(data, COMMISSIONER_UPDATE_ZERO_ROW);
  if (!confirmed.ok) {
    return { ...initialHelpers, error: confirmed.error };
  }

  revalidateLeaguePaths();
  return {
    error: null,
    success: `Week ${confirmed.row.week_number} updated.`,
  };
}

export async function setWeekStatus(
  _prev: WeekActionState,
  formData: FormData,
): Promise<WeekActionState> {
  const auth = await requireCommissionerContext();
  if (!auth.ok) {
    return { ...initialHelpers, error: auth.error };
  }

  const weekId = String(formData.get("week_id") ?? "").trim();
  const nextStatus = String(formData.get("status") ?? "").trim() as WeekStatus;
  const confirm = String(formData.get("confirm") ?? "") === "yes";

  if (!weekId || (nextStatus !== "open" && nextStatus !== "locked")) {
    return { ...initialHelpers, error: "Missing week or invalid status action." };
  }

  if (nextStatus === "locked" && !confirm) {
    return {
      ...initialHelpers,
      error: "Confirm locking this week before continuing.",
    };
  }

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("weeks")
    .select("id, week_number, locks_at, status")
    .eq("id", weekId)
    .eq("season_id", auth.context.season.id)
    .maybeSingle();

  if (loadError || !existing) {
    return {
      ...initialHelpers,
      error: loadError
        ? mapWeekMutationError(loadError)
        : "Week not found for this season.",
    };
  }

  const transitionError = canTransitionWeekStatus(
    { status: existing.status, locksAt: existing.locks_at },
    nextStatus,
  );
  if (transitionError) {
    return { ...initialHelpers, error: transitionError };
  }

  if (nextStatus === "open") {
    const openCheck = await assertCanOpenWeek(auth.context.season.id, weekId);
    if (openCheck) {
      return { ...initialHelpers, error: openCheck };
    }
  }

  const { data, error } = await supabase
    .from("weeks")
    .update({ status: nextStatus })
    .eq("id", weekId)
    .eq("season_id", auth.context.season.id)
    .eq("status", existing.status)
    .select("id, week_number, status")
    .maybeSingle();

  if (error) {
    return { ...initialHelpers, error: mapWeekMutationError(error) };
  }

  const confirmed = requireMutationRow(data, COMMISSIONER_UPDATE_ZERO_ROW);
  if (!confirmed.ok) {
    return { ...initialHelpers, error: confirmed.error };
  }

  revalidateLeaguePaths();

  const verb =
    nextStatus === "open" ? "opened for picks" : "locked";

  return {
    error: null,
    success: `Week ${confirmed.row.week_number} ${verb}.`,
  };
}

export async function activateSeason(
  _prev: WeekActionState,
  formData: FormData,
): Promise<WeekActionState> {
  const auth = await requireCommissionerContext();
  if (!auth.ok) {
    return { ...initialHelpers, error: auth.error };
  }

  const confirm = String(formData.get("confirm") ?? "") === "yes";
  if (!confirm) {
    return {
      ...initialHelpers,
      error: "Confirm season activation before continuing.",
    };
  }

  // Never trust submitted season ids or roles — use session context only.
  void formData.get("season_id");
  void formData.get("role");
  void formData.get("user_id");

  const seasonId = auth.context.season.id;
  if (auth.context.season.status !== "setup") {
    return {
      ...initialHelpers,
      error: "Only a season in setup can be activated.",
    };
  }

  const supabase = await createClient();

  const [{ count: weekCount, error: weekCountError }, scoring] =
    await Promise.all([
      supabase
        .from("weeks")
        .select("id", { count: "exact", head: true })
        .eq("season_id", seasonId),
      Promise.resolve(auth.context.scoringRules),
    ]);

  if (weekCountError) {
    return {
      ...initialHelpers,
      error: "Could not verify weeks before activation. Try again.",
    };
  }

  const blocked = activationBlockedReason({
    status: auth.context.season.status,
    hasScoringRules: Boolean(scoring),
    weekCount: weekCount ?? 0,
  });
  if (blocked) {
    return { ...initialHelpers, error: blocked };
  }

  const { data, error } = await supabase
    .from("seasons")
    .update({ status: "active" })
    .eq("id", seasonId)
    .eq("status", "setup")
    .select("id, status")
    .maybeSingle();

  if (error) {
    return {
      ...initialHelpers,
      error: mapWeekMutationError(error),
    };
  }

  const confirmed = requireMutationRow(data, SEASON_ACTIVATION_ZERO_ROW);
  if (!confirmed.ok) {
    return { ...initialHelpers, error: confirmed.error };
  }

  const interpreted = interpretSeasonActivationRow(confirmed.row);
  if (!interpreted.ok) {
    return { ...initialHelpers, error: interpreted.error };
  }

  revalidateLeaguePaths();
  return {
    error: null,
    success:
      "Season activated. Players can submit picks once a week is marked open.",
  };
}

async function assertCanOpenWeek(
  seasonId: string,
  exceptWeekId?: string,
): Promise<string | null> {
  const supabase = await createClient();
  let query = supabase
    .from("weeks")
    .select("id, week_number")
    .eq("season_id", seasonId)
    .eq("status", "open");

  if (exceptWeekId) {
    query = query.neq("id", exceptWeekId);
  }

  const { data, error } = await query;
  if (error) {
    return mapWeekMutationError(error);
  }

  if ((data?.length ?? 0) > 0) {
    const labels = (data ?? [])
      .map((week) => `Week ${week.week_number}`)
      .join(", ");
    return `Another week is already open (${labels}). Lock it before opening this week.`;
  }

  return null;
}

export async function listSeasonWeeks(seasonId: string): Promise<{
  weeks: WeekRow[];
  error: string | null;
}> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("weeks")
    .select("id, season_id, week_number, label, locks_at, status")
    .eq("season_id", seasonId)
    .order("week_number", { ascending: true });

  if (error) {
    return { weeks: [], error: "Could not load weeks." };
  }

  return { weeks: (data ?? []) as WeekRow[], error: null };
}
