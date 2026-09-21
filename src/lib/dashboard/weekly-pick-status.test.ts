import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveWeeklyPickDisplayState } from "./weekly-pick-status.ts";

describe("resolveWeeklyPickDisplayState", () => {
  it("shows visible when an authorized pick row exists", () => {
    assert.equal(
      resolveWeeklyPickDisplayState({ hasVisiblePick: true, hasPick: true }),
      "visible",
    );
  });

  it("shows Submitted/hidden when has_pick but no visible row", () => {
    assert.equal(
      resolveWeeklyPickDisplayState({ hasVisiblePick: false, hasPick: true }),
      "hidden",
    );
  });

  it("shows Not submitted/missing when has_pick is false", () => {
    assert.equal(
      resolveWeeklyPickDisplayState({ hasVisiblePick: false, hasPick: false }),
      "missing",
    );
  });
});
