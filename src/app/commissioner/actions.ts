"use server";

import { revalidatePath } from "next/cache";

import { commissionerActionDenied } from "@/lib/auth/identity";
import {
  loadLeagueContext,
  type WeekRow,
} from "@/lib/league/context";
import type { WeekStatus } from "@/lib/database.types";
import { mapWeekMutationError } from "@/lib/picks/errors";
import { createClient } from "@/lib/supabase/server";
import { chicagoWallTimeToUtcIso } from "@/lib/time/chicago";
import {
  isValidRegularWeekNumber,
  type WeekLike,
} from "@/lib/weeks/open-week";

export type WeekActionState = {
  error: string | null;
  success: string | null;
};

const initialHelpers = {
  error: null,
  success: null,
} satisfies WeekActionState;

const ALLOWED_STATUSES: WeekStatus[] = [
  "upcoming",
  "open",
  "locked",
  "final",
];

function parseStatus(raw: FormDataEntryValue | null): WeekStatus | null {
  const value = String(raw ?? "");
  return ALLOWED_STATUSES.includes(value as WeekStatus)
    ? (value as WeekStatus)
    : null;
}

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
  const status = parseStatus(formData.get("status")) ?? "upcoming";

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

  if (status === "open") {
    const openCheck = await assertCanOpenWeek(auth.context.season.id);
    if (openCheck) {
      return { ...initialHelpers, error: openCheck };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from("weeks").insert({
    season_id: auth.context.season.id,
    week_number: weekNumber,
    label,
    locks_at: locksAt,
    status,
  });

  if (error) {
    return { ...initialHelpers, error: mapWeekMutationError(error) };
  }

  revalidatePath("/commissioner");
  revalidatePath("/pick");
  revalidatePath("/availability");
  revalidatePath("/history");
  revalidatePath("/");

  return {
    error: null,
    success: `Week ${weekNumber} created.`,
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
  const status = parseStatus(formData.get("status"));

  if (!weekId) {
    return { ...initialHelpers, error: "Missing week id." };
  }
  if (!label) {
    return { ...initialHelpers, error: "Label is required." };
  }
  if (!status) {
    return { ...initialHelpers, error: "Choose a valid status." };
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

  const now = Date.now();
  if (new Date(existing.locks_at).getTime() <= now) {
    return {
      ...initialHelpers,
      error:
        "This week’s lock time has already passed. Future/unlocked weeks can be edited.",
    };
  }

  if (status === "open" && existing.status !== "open") {
    const openCheck = await assertCanOpenWeek(auth.context.season.id, weekId);
    if (openCheck) {
      return { ...initialHelpers, error: openCheck };
    }
  }

  const { error } = await supabase
    .from("weeks")
    .update({
      label,
      locks_at: locksAt,
      status,
    })
    .eq("id", weekId)
    .eq("season_id", auth.context.season.id);

  if (error) {
    return { ...initialHelpers, error: mapWeekMutationError(error) };
  }

  revalidatePath("/commissioner");
  revalidatePath("/pick");
  revalidatePath("/availability");
  revalidatePath("/history");
  revalidatePath("/");

  return {
    error: null,
    success: `Week ${existing.week_number} updated.`,
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
  const status = parseStatus(formData.get("status"));
  const confirm = String(formData.get("confirm") ?? "") === "yes";

  if (!weekId || !status) {
    return { ...initialHelpers, error: "Missing week or status." };
  }

  if ((status === "locked" || status === "final") && !confirm) {
    return {
      ...initialHelpers,
      error: "Confirm locking or closing this week before continuing.",
    };
  }

  if (status === "open") {
    const openCheck = await assertCanOpenWeek(auth.context.season.id, weekId);
    if (openCheck) {
      return { ...initialHelpers, error: openCheck };
    }
  }

  const supabase = await createClient();
  const { data: existing, error: loadError } = await supabase
    .from("weeks")
    .select("week_number")
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

  const { error } = await supabase
    .from("weeks")
    .update({ status })
    .eq("id", weekId)
    .eq("season_id", auth.context.season.id);

  if (error) {
    return { ...initialHelpers, error: mapWeekMutationError(error) };
  }

  revalidatePath("/commissioner");
  revalidatePath("/pick");
  revalidatePath("/availability");
  revalidatePath("/history");
  revalidatePath("/");

  const verb =
    status === "open"
      ? "opened for picks"
      : status === "locked"
        ? "locked"
        : status === "final"
          ? "marked final"
          : "set to upcoming";

  return {
    error: null,
    success: `Week ${existing.week_number} ${verb}.`,
  };
}

async function assertCanOpenWeek(
  seasonId: string,
  exceptWeekId?: string,
): Promise<string | null> {
  const supabase = await createClient();
  let query = supabase
    .from("weeks")
    .select("id, week_number, label, locks_at, status")
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
    const labels = (data as WeekLike[])
      .map((week) => `Week ${week.week_number}`)
      .join(", ");
    return `Only one week can be open. Close ${labels} before opening another.`;
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
