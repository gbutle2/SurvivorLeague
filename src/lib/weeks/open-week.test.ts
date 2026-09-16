import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveOpenWeek } from "./open-week.ts";

describe("resolveOpenWeek", () => {
  it("returns the single open week", () => {
    const result = resolveOpenWeek([
      {
        id: "1",
        week_number: 1,
        label: "W1",
        locks_at: "2026-09-10T00:00:00Z",
        status: "locked",
      },
      {
        id: "2",
        week_number: 2,
        label: "W2",
        locks_at: "2026-09-17T00:00:00Z",
        status: "open",
      },
    ]);
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.equal(result.week.id, "2");
    }
  });

  it("returns none when no week is open", () => {
    const result = resolveOpenWeek([
      {
        id: "1",
        week_number: 1,
        label: "W1",
        locks_at: "2026-09-10T00:00:00Z",
        status: "upcoming",
      },
    ]);
    assert.equal(result.kind, "none");
  });

  it("returns multiple when more than one week is open", () => {
    const result = resolveOpenWeek([
      {
        id: "1",
        week_number: 1,
        label: "W1",
        locks_at: "2026-09-10T00:00:00Z",
        status: "open",
      },
      {
        id: "2",
        week_number: 2,
        label: "W2",
        locks_at: "2026-09-17T00:00:00Z",
        status: "open",
      },
    ]);
    assert.equal(result.kind, "multiple");
    if (result.kind === "multiple") {
      assert.equal(result.weeks.length, 2);
    }
  });
});
