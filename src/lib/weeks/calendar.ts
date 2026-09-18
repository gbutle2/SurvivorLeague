import { chicagoWallTimeToUtcIso } from "../time/chicago.ts";

const UPCOMING = "upcoming" as const;

export type CalendarDeadlineInput = {
  week_number: number;
  label?: string;
  /** YYYY-MM-DD in America/Chicago */
  lock_date: string;
  /** HH:mm or HH:mm:ss in America/Chicago */
  lock_time: string;
};

export type PreparedCalendarWeek = {
  week_number: number;
  label: string;
  locks_at: string;
  status: typeof UPCOMING;
};

export type ExistingWeekSnapshot = {
  week_number: number;
  label: string;
  locks_at: string;
  status: string;
};

export type CalendarPlan =
  | {
      ok: true;
      weeksToInsert: PreparedCalendarWeek[];
      skippedExisting: number[];
      conflicts: Array<{
        week_number: number;
        message: string;
      }>;
    }
  | { ok: false; error: string };

function defaultLabel(weekNumber: number): string {
  return `Week ${weekNumber}`;
}

/**
 * Validate a complete season calendar (1..weekCount sequential) and plan
 * idempotent inserts. Existing weeks are never overwritten.
 */
export function planSeasonCalendar(options: {
  weekCount: number;
  inputs: CalendarDeadlineInput[];
  existing: ExistingWeekSnapshot[];
}): CalendarPlan {
  const { weekCount, inputs, existing } = options;

  if (!Number.isInteger(weekCount) || weekCount < 1) {
    return { ok: false, error: "Season week count is invalid." };
  }

  if (inputs.length !== weekCount) {
    return {
      ok: false,
      error: `Provide exactly ${weekCount} week deadlines (got ${inputs.length}).`,
    };
  }

  const byNumber = new Map<number, CalendarDeadlineInput>();
  for (const input of inputs) {
    if (!Number.isInteger(input.week_number)) {
      return { ok: false, error: "Week numbers must be integers." };
    }
    if (byNumber.has(input.week_number)) {
      return {
        ok: false,
        error: `Duplicate week number ${input.week_number}.`,
      };
    }
    byNumber.set(input.week_number, input);
  }

  for (let n = 1; n <= weekCount; n += 1) {
    if (!byNumber.has(n)) {
      return {
        ok: false,
        error: `Missing week ${n}. Provide sequential weeks 1–${weekCount}.`,
      };
    }
  }

  const existingByNumber = new Map(
    existing.map((week) => [week.week_number, week]),
  );

  const weeksToInsert: PreparedCalendarWeek[] = [];
  const skippedExisting: number[] = [];
  const conflicts: Array<{ week_number: number; message: string }> = [];

  for (let n = 1; n <= weekCount; n += 1) {
    const input = byNumber.get(n)!;
    const label = (input.label ?? defaultLabel(n)).trim() || defaultLabel(n);

    let locksAt: string;
    try {
      locksAt = chicagoWallTimeToUtcIso(input.lock_date, input.lock_time);
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `Week ${n}: ${error.message}`
            : `Week ${n}: invalid Central Time deadline.`,
      };
    }

    const prior = existingByNumber.get(n);
    if (prior) {
      const sameLabel = prior.label === label;
      const sameLock =
        new Date(prior.locks_at).getTime() === new Date(locksAt).getTime();
      if (!sameLabel || !sameLock) {
        conflicts.push({
          week_number: n,
          message: `Week ${n} already exists and differs from the submitted calendar (not overwritten).`,
        });
      } else {
        skippedExisting.push(n);
      }
      continue;
    }

    weeksToInsert.push({
      week_number: n,
      label,
      locks_at: locksAt,
      status: UPCOMING,
    });
  }

  // Never insert alongside conflicts — avoids a partially applied calendar.
  if (conflicts.length > 0) {
    return {
      ok: true,
      weeksToInsert: [],
      skippedExisting,
      conflicts,
    };
  }

  return {
    ok: true,
    weeksToInsert,
    skippedExisting,
    conflicts,
  };
}
