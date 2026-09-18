import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveCurrentWeek } from "./current-week.ts";
import type { WeekLike } from "./open-week.ts";

function week(
  partial: Partial<WeekLike> & Pick<WeekLike, "id" | "week_number" | "status">,
): WeekLike {
  return {
    label: `Week ${partial.week_number}`,
    locks_at: partial.locks_at ?? "2099-01-01T18:00:00.000Z",
    ...partial,
  };
}

describe("resolveCurrentWeek", () => {
  it("resolves exactly one open week as actionable", () => {
    const current = resolveCurrentWeek(
      [
        week({ id: "1", week_number: 1, status: "final" }),
        week({
          id: "2",
          week_number: 2,
          status: "open",
          locks_at: "2099-09-14T17:00:00.000Z",
        }),
        week({ id: "3", week_number: 3, status: "upcoming" }),
      ],
      new Date("2026-09-10T12:00:00.000Z"),
    );
    assert.equal(current.kind, "actionable");
    if (current.kind === "actionable") {
      assert.equal(current.week.week_number, 2);
      assert.equal(current.picksAllowed, true);
    }
  });

  it("shows next upcoming informationally when none are open", () => {
    const current = resolveCurrentWeek(
      [
        week({ id: "1", week_number: 1, status: "locked" }),
        week({
          id: "2",
          week_number: 2,
          status: "upcoming",
          locks_at: "2099-09-14T17:00:00.000Z",
        }),
        week({ id: "3", week_number: 3, status: "upcoming" }),
      ],
      new Date("2026-09-10T12:00:00.000Z"),
    );
    assert.equal(current.kind, "informational");
    if (current.kind === "informational") {
      assert.equal(current.week.week_number, 2);
      assert.equal(current.picksAllowed, false);
    }
  });

  it("returns configuration error for multiple open weeks", () => {
    const current = resolveCurrentWeek([
      week({ id: "1", week_number: 1, status: "open" }),
      week({ id: "2", week_number: 2, status: "open" }),
    ]);
    assert.equal(current.kind, "multiple_open");
    if (current.kind === "multiple_open") {
      assert.equal(current.picksAllowed, false);
      assert.equal(current.weeks.length, 2);
    }
  });

  it("treats expired open week as not pickable", () => {
    const current = resolveCurrentWeek(
      [
        week({
          id: "1",
          week_number: 1,
          status: "open",
          locks_at: "2026-09-01T17:00:00.000Z",
        }),
      ],
      new Date("2026-09-10T12:00:00.000Z"),
    );
    assert.equal(current.kind, "open_expired");
    if (current.kind === "open_expired") {
      assert.equal(current.picksAllowed, false);
      assert.equal(current.reason, "deadline_passed");
    }
  });
});
