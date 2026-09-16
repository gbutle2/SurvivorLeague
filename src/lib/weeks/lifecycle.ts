import type { WeekStatus } from "@/lib/database.types";

function deadlinePassed(locksAt: string, now: Date): boolean {
  return new Date(locksAt).getTime() <= now.getTime();
}

export type WeekLifecycleState = {
  status: WeekStatus;
  locksAt: string;
};

export type AllowedStatusTransition =
  | { from: "upcoming"; to: "open" }
  | { from: "open"; to: "locked" };

/** New weeks are always created as upcoming. */
export const CREATE_WEEK_STATUS: WeekStatus = "upcoming";

export function assertFutureDeadline(
  locksAtIso: string,
  now: Date = new Date(),
): string | null {
  if (new Date(locksAtIso).getTime() <= now.getTime()) {
    return "The deadline must be in the future (Central Time).";
  }
  return null;
}

export function canEditWeekDetails(
  week: WeekLifecycleState,
  now: Date = new Date(),
): string | null {
  if (week.status === "locked" || week.status === "final") {
    return "Locked and final weeks are read-only in this phase.";
  }
  if (week.status !== "upcoming" && week.status !== "open") {
    return "Only upcoming or open weeks can be edited.";
  }
  if (deadlinePassed(week.locksAt, now)) {
    return "This week’s deadline has already passed. It can no longer be edited.";
  }
  return null;
}

export function canTransitionWeekStatus(
  week: WeekLifecycleState,
  next: WeekStatus,
  now: Date = new Date(),
): string | null {
  if (week.status === "locked" || week.status === "final") {
    return "Locked and final weeks cannot be reopened in this phase.";
  }

  if (next === "open") {
    if (week.status !== "upcoming") {
      return "Only upcoming weeks can be opened for picks.";
    }
    if (deadlinePassed(week.locksAt, now)) {
      return "This week’s deadline has already passed. It cannot be opened.";
    }
    return null;
  }

  if (next === "locked") {
    if (week.status !== "open") {
      return "Only an open week can be locked.";
    }
    return null;
  }

  return "That status change is not allowed in this phase.";
}

export function isStatusTransitionAllowed(
  from: WeekStatus,
  to: WeekStatus,
): boolean {
  if (from === "upcoming" && to === "open") {
    return true;
  }
  if (from === "open" && to === "locked") {
    return true;
  }
  return false;
}

export type WeekPresentation =
  | { kind: "upcoming"; label: string; tone: "neutral" }
  | { kind: "open_active"; label: string; tone: "active" }
  | { kind: "open_expired"; label: string; tone: "expired" }
  | { kind: "locked"; label: string; tone: "locked" }
  | { kind: "final"; label: string; tone: "locked" };

export function presentWeekState(
  week: WeekLifecycleState,
  now: Date = new Date(),
): WeekPresentation {
  if (week.status === "final") {
    return { kind: "final", label: "Final", tone: "locked" };
  }
  if (week.status === "locked") {
    return { kind: "locked", label: "Locked", tone: "locked" };
  }
  if (week.status === "open") {
    if (deadlinePassed(week.locksAt, now)) {
      return {
        kind: "open_expired",
        label: "Deadline passed",
        tone: "expired",
      };
    }
    return { kind: "open_active", label: "Open", tone: "active" };
  }
  return { kind: "upcoming", label: "Upcoming", tone: "neutral" };
}

export function canShowOpenAction(
  week: WeekLifecycleState,
  now: Date = new Date(),
): boolean {
  return canTransitionWeekStatus(week, "open", now) === null;
}

export function canShowLockAction(week: WeekLifecycleState): boolean {
  return week.status === "open";
}
