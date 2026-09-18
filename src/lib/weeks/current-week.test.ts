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
  it("makes Week 2 current after Week 1 is final (no stored open required)", () => {
    const current = resolveCurrentWeek(
      [
        week({
          id: "1",
          week_number: 1,
          status: "final",
          locks_at: "2026-09-01T17:00:00.000Z",
        }),
        week({
          id: "2",
          week_number: 2,
          status: "upcoming",
          locks_at: "2099-09-14T17:00:00.000Z",
        }),
        week({
          id: "3",
          week_number: 3,
          status: "upcoming",
          locks_at: "2099-09-21T17:00:00.000Z",
        }),
      ],
      new Date("2026-09-10T12:00:00.000Z"),
    );
    assert.equal(current.kind, "actionable");
    if (current.kind === "actionable") {
      assert.equal(current.week.week_number, 2);
      assert.equal(current.picksAllowed, true);
      assert.equal(current.reason, "effective_current");
    }
  });

  it("advances Week 3 automatically after Week 2 deadline", () => {
    const current = resolveCurrentWeek(
      [
        week({
          id: "1",
          week_number: 1,
          status: "final",
          locks_at: "2026-09-01T17:00:00.000Z",
        }),
        week({
          id: "2",
          week_number: 2,
          status: "upcoming",
          locks_at: "2026-09-08T17:00:00.000Z",
        }),
        week({
          id: "3",
          week_number: 3,
          status: "upcoming",
          locks_at: "2099-09-15T17:00:00.000Z",
        }),
      ],
      new Date("2026-09-10T12:00:00.000Z"),
    );
    assert.equal(current.kind, "actionable");
    if (current.kind === "actionable") {
      assert.equal(current.week.week_number, 3);
      assert.equal(current.staleExpired.map((w) => w.week_number).join(","), "2");
    }
  });

  it("does not require a stored open status", () => {
    const current = resolveCurrentWeek([
      week({ id: "1", week_number: 1, status: "upcoming" }),
    ]);
    assert.equal(current.kind, "actionable");
    if (current.kind === "actionable") {
      assert.equal(current.week.status, "upcoming");
    }
  });

  it("reports expired unresolved weeks but skips them for eligibility", () => {
    const current = resolveCurrentWeek(
      [
        week({
          id: "1",
          week_number: 1,
          status: "upcoming",
          locks_at: "2026-09-01T17:00:00.000Z",
        }),
        week({
          id: "2",
          week_number: 2,
          status: "open",
          locks_at: "2026-09-05T17:00:00.000Z",
        }),
        week({
          id: "3",
          week_number: 3,
          status: "upcoming",
          locks_at: "2099-09-15T17:00:00.000Z",
        }),
      ],
      new Date("2026-09-10T12:00:00.000Z"),
    );
    assert.equal(current.kind, "actionable");
    if (current.kind === "actionable") {
      assert.equal(current.week.week_number, 3);
      assert.deepEqual(
        current.staleExpired.map((w) => w.week_number),
        [1, 2],
      );
    }
  });

  it("keeps eligibility singular when multiple stored open rows exist", () => {
    const current = resolveCurrentWeek([
      week({
        id: "1",
        week_number: 1,
        status: "upcoming",
        locks_at: "2099-09-07T17:00:00.000Z",
      }),
      week({
        id: "2",
        week_number: 2,
        status: "open",
        locks_at: "2099-09-14T17:00:00.000Z",
      }),
      week({
        id: "3",
        week_number: 3,
        status: "open",
        locks_at: "2099-09-21T17:00:00.000Z",
      }),
    ]);
    assert.equal(current.kind, "actionable");
    if (current.kind === "actionable") {
      assert.equal(current.week.week_number, 1);
      assert.equal(current.multipleOpenWarning.length, 2);
    }
  });

  it("skips locked candidates even if deadline is still future", () => {
    const current = resolveCurrentWeek([
      week({
        id: "1",
        week_number: 1,
        status: "locked",
        locks_at: "2099-09-07T17:00:00.000Z",
      }),
      week({
        id: "2",
        week_number: 2,
        status: "upcoming",
        locks_at: "2099-09-14T17:00:00.000Z",
      }),
    ]);
    assert.equal(current.kind, "actionable");
    if (current.kind === "actionable") {
      assert.equal(current.week.week_number, 2);
    }
  });

  it("returns season complete when no eligible future week remains", () => {
    const current = resolveCurrentWeek(
      [
        week({
          id: "1",
          week_number: 1,
          status: "final",
          locks_at: "2026-09-01T17:00:00.000Z",
        }),
        week({
          id: "2",
          week_number: 2,
          status: "upcoming",
          locks_at: "2026-09-08T17:00:00.000Z",
        }),
      ],
      new Date("2026-09-10T12:00:00.000Z"),
    );
    assert.equal(current.kind, "none");
    if (current.kind === "none") {
      assert.equal(current.reason, "season_complete");
    }
  });
});
