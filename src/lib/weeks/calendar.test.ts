import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  planSeasonCalendar,
  type CalendarDeadlineInput,
} from "./calendar.ts";

function seventeenWeeks(
  overrides?: Partial<Record<number, Partial<CalendarDeadlineInput>>>,
): CalendarDeadlineInput[] {
  return Array.from({ length: 17 }, (_, index) => {
    const weekNumber = index + 1;
    const base: CalendarDeadlineInput = {
      week_number: weekNumber,
      label: `Week ${weekNumber}`,
      lock_date: `2026-09-${String(Math.min(8 + weekNumber, 28)).padStart(2, "0")}`,
      lock_time: "12:00",
    };
    return { ...base, ...(overrides?.[weekNumber] ?? {}) };
  });
}

describe("planSeasonCalendar", () => {
  it("requires all 17 sequential weeks", () => {
    const plan = planSeasonCalendar({
      weekCount: 17,
      inputs: seventeenWeeks().slice(0, 16),
      existing: [],
    });
    assert.equal(plan.ok, false);
    if (!plan.ok) {
      assert.match(plan.error, /exactly 17/i);
    }
  });

  it("rejects duplicate week numbers", () => {
    const inputs = seventeenWeeks();
    inputs[5] = { ...inputs[5]!, week_number: 1 };
    const plan = planSeasonCalendar({
      weekCount: 17,
      inputs,
      existing: [],
    });
    assert.equal(plan.ok, false);
    if (!plan.ok) {
      assert.match(plan.error, /duplicate/i);
    }
  });

  it("rejects missing weeks in a non-sequential set", () => {
    const inputs = seventeenWeeks();
    inputs[3] = { ...inputs[3]!, week_number: 99 };
    const plan = planSeasonCalendar({
      weekCount: 17,
      inputs,
      existing: [],
    });
    assert.equal(plan.ok, false);
    if (!plan.ok) {
      assert.match(plan.error, /missing week 4/i);
    }
  });

  it("rejects invalid Central Time", () => {
    const plan = planSeasonCalendar({
      weekCount: 17,
      inputs: seventeenWeeks({
        2: { lock_date: "not-a-date", lock_time: "12:00" },
      }),
      existing: [],
    });
    assert.equal(plan.ok, false);
    if (!plan.ok) {
      assert.match(plan.error, /week 2/i);
    }
  });

  it("retry does not duplicate weeks when identical", () => {
    const inputs = seventeenWeeks();
    const first = planSeasonCalendar({
      weekCount: 17,
      inputs,
      existing: [],
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const second = planSeasonCalendar({
      weekCount: 17,
      inputs,
      existing: first.weeksToInsert.map((week) => ({
        week_number: week.week_number,
        label: week.label,
        locks_at: week.locks_at,
        status: week.status,
      })),
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.weeksToInsert.length, 0);
    assert.equal(second.skippedExisting.length, 17);
    assert.equal(second.conflicts.length, 0);
  });

  it("does not overwrite conflicting existing weeks", () => {
    const inputs = seventeenWeeks();
    const first = planSeasonCalendar({
      weekCount: 17,
      inputs,
      existing: [],
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    const existing = first.weeksToInsert.map((week) => ({
      week_number: week.week_number,
      label: week.label,
      locks_at: week.locks_at,
      status: week.status,
    }));
    existing[0] = {
      ...existing[0]!,
      label: "Different label",
    };

    const changed = seventeenWeeks({
      1: { label: "Week 1", lock_time: "13:00" },
    });
    const plan = planSeasonCalendar({
      weekCount: 17,
      inputs: changed,
      existing,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.weeksToInsert.length, 0);
    assert.ok(plan.conflicts.length >= 1);
    assert.match(plan.conflicts[0]!.message, /not overwritten/i);
  });
});
