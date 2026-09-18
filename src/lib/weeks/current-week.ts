import type { WeekStatus } from "@/lib/database.types";
import { resolveOpenWeek, type WeekLike } from "./open-week.ts";

export type CurrentWeekResolution<T extends WeekLike> =
  | {
      kind: "actionable";
      week: T;
      picksAllowed: true;
      reason: "single_open";
    }
  | {
      kind: "open_expired";
      week: T;
      picksAllowed: false;
      reason: "deadline_passed";
    }
  | {
      kind: "informational";
      week: T;
      picksAllowed: false;
      reason: "next_upcoming";
    }
  | { kind: "none"; picksAllowed: false }
  | {
      kind: "multiple_open";
      weeks: T[];
      picksAllowed: false;
    };

function isLockedAt(locksAt: string, now: Date): boolean {
  return new Date(locksAt).getTime() <= now.getTime();
}

/**
 * Shared server-side resolver for the regular-season week the app should show.
 * Authority comes from stored statuses and deadlines, not browser time.
 */
export function resolveCurrentWeek<T extends WeekLike>(
  weeks: T[],
  now: Date = new Date(),
): CurrentWeekResolution<T> {
  const open = resolveOpenWeek(weeks);

  if (open.kind === "multiple") {
    return { kind: "multiple_open", weeks: open.weeks, picksAllowed: false };
  }

  if (open.kind === "ok") {
    if (isLockedAt(open.week.locks_at, now)) {
      return {
        kind: "open_expired",
        week: open.week,
        picksAllowed: false,
        reason: "deadline_passed",
      };
    }
    return {
      kind: "actionable",
      week: open.week,
      picksAllowed: true,
      reason: "single_open",
    };
  }

  const upcoming = weeks
    .filter((week) => week.status === "upcoming")
    .sort((a, b) => {
      if (a.week_number !== b.week_number) {
        return a.week_number - b.week_number;
      }
      return (
        new Date(a.locks_at).getTime() - new Date(b.locks_at).getTime()
      );
    });

  if (upcoming.length === 0) {
    return { kind: "none", picksAllowed: false };
  }

  return {
    kind: "informational",
    week: upcoming[0]!,
    picksAllowed: false,
    reason: "next_upcoming",
  };
}

export function isHistoricalWeekStatus(status: WeekStatus): boolean {
  return status === "locked" || status === "final";
}
