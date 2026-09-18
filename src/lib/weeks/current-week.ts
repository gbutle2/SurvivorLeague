import type { WeekStatus } from "@/lib/database.types";
import type { WeekLike } from "./open-week.ts";

export type CurrentWeekResolution<T extends WeekLike> =
  | {
      kind: "actionable";
      week: T;
      picksAllowed: true;
      reason: "effective_current";
      /** Expired upcoming/open rows skipped for eligibility (commissioner attention). */
      staleExpired: T[];
      /** Explicit stored open rows — warning only; eligibility stays singular. */
      multipleOpenWarning: T[];
    }
  | {
      kind: "none";
      picksAllowed: false;
      reason: "season_complete" | "no_weeks";
      staleExpired: T[];
      multipleOpenWarning: T[];
    };

function isLockedAt(locksAt: string, now: Date): boolean {
  return new Date(locksAt).getTime() <= now.getTime();
}

function isHistoricalStatus(status: WeekStatus): boolean {
  return status === "locked" || status === "final";
}

/**
 * Shared server-side resolver matching database effective-current-week semantics.
 *
 * Eligible weeks: status not locked/final, locks_at > now().
 * Actionable week: lowest week_number among eligible.
 * Stored `open` does not override an earlier eligible week.
 */
export function resolveCurrentWeek<T extends WeekLike>(
  weeks: T[],
  now: Date = new Date(),
): CurrentWeekResolution<T> {
  if (weeks.length === 0) {
    return {
      kind: "none",
      picksAllowed: false,
      reason: "no_weeks",
      staleExpired: [],
      multipleOpenWarning: [],
    };
  }

  const staleExpired = weeks
    .filter(
      (week) =>
        !isHistoricalStatus(week.status) && isLockedAt(week.locks_at, now),
    )
    .sort((a, b) => a.week_number - b.week_number);

  const multipleOpenWarning = weeks
    .filter((week) => week.status === "open")
    .sort((a, b) => a.week_number - b.week_number);

  const eligible = weeks
    .filter(
      (week) =>
        !isHistoricalStatus(week.status) && !isLockedAt(week.locks_at, now),
    )
    .sort((a, b) => a.week_number - b.week_number);

  if (eligible.length === 0) {
    return {
      kind: "none",
      picksAllowed: false,
      reason: "season_complete",
      staleExpired,
      multipleOpenWarning,
    };
  }

  return {
    kind: "actionable",
    week: eligible[0]!,
    picksAllowed: true,
    reason: "effective_current",
    staleExpired,
    multipleOpenWarning,
  };
}

export function isHistoricalWeekStatus(status: WeekStatus): boolean {
  return isHistoricalStatus(status);
}
