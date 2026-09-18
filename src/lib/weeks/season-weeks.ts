import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, WeekStatus } from "@/lib/database.types";
import { resolveCurrentWeek } from "@/lib/weeks/current-week";
import type { WeekLike } from "@/lib/weeks/open-week";

export type SeasonWeekRow = WeekLike & {
  season_id?: string;
};

export async function loadSeasonWeeks(
  supabase: SupabaseClient<Database>,
  seasonId: string,
): Promise<{ weeks: SeasonWeekRow[]; error: string | null }> {
  const { data, error } = await supabase
    .from("weeks")
    .select("id, week_number, label, locks_at, status")
    .eq("season_id", seasonId)
    .order("week_number", { ascending: true });

  if (error) {
    return { weeks: [], error: "Could not load weeks." };
  }

  return { weeks: (data ?? []) as SeasonWeekRow[], error: null };
}

export function resolveSeasonCurrentWeek(
  weeks: SeasonWeekRow[],
  now: Date = new Date(),
) {
  return resolveCurrentWeek(weeks, now);
}

export function summarizeCalendar(weeks: SeasonWeekRow[], weekCount: number) {
  return {
    configured: weeks.length,
    expected: weekCount,
    complete: weeks.length >= weekCount,
    byStatus: weeks.reduce(
      (acc, week) => {
        acc[week.status] = (acc[week.status] ?? 0) + 1;
        return acc;
      },
      {} as Partial<Record<WeekStatus, number>>,
    ),
  };
}
