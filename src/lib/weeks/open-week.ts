import type { WeekStatus } from "@/lib/database.types";

export type WeekLike = {
  id: string;
  week_number: number;
  label: string;
  locks_at: string;
  status: WeekStatus;
};

export type OpenWeekResolution<T extends WeekLike> =
  | { kind: "ok"; week: T }
  | { kind: "none" }
  | { kind: "multiple"; weeks: T[] };

/** Resolve the single regular-season week with status `open`. */
export function resolveOpenWeek<T extends WeekLike>(
  weeks: T[],
): OpenWeekResolution<T> {
  const open = weeks
    .filter((week) => week.status === "open")
    .sort((a, b) => a.week_number - b.week_number);

  if (open.length === 0) {
    return { kind: "none" };
  }

  if (open.length > 1) {
    return { kind: "multiple", weeks: open };
  }

  return { kind: "ok", week: open[0]! };
}

export const REGULAR_WEEK_MIN = 1;
export const REGULAR_WEEK_MAX = 17;

export function isValidRegularWeekNumber(weekNumber: number): boolean {
  return (
    Number.isInteger(weekNumber) &&
    weekNumber >= REGULAR_WEEK_MIN &&
    weekNumber <= REGULAR_WEEK_MAX
  );
}
