import type { PickResult } from "@/lib/database.types";

type WeekRef = { id: string; weekNumber: number; status: string };
type PickRef = { userId: string; weekId: string; result: PickResult };

/**
 * Survivor status after scoring weeks through `throughWeekNumber`
 * (inclusive). Pending / non-final weeks do not eliminate.
 */
export function survivorAliveThroughWeek(
  userId: string,
  weeks: WeekRef[],
  picks: PickRef[],
  throughWeekNumber: number,
): boolean {
  const ordered = weeks
    .filter((week) => week.weekNumber <= throughWeekNumber)
    .sort((a, b) => a.weekNumber - b.weekNumber);

  for (const week of ordered) {
    const pick = picks.find(
      (row) => row.userId === userId && row.weekId === week.id,
    );
    if (pick?.result === "win") continue;
    if (pick?.result === "loss" || pick?.result === "tie") return false;
    if (pick?.result === "pending" || week.status !== "final") return true;
    return false; // final miss
  }
  return true;
}

export function weeklyPointsForResult(
  result: PickResult | null | undefined,
  regularPickPoints: number,
): number {
  return result === "win" ? regularPickPoints : 0;
}
