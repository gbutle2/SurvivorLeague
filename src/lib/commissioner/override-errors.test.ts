import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mapCommissionerOverrideError,
  resultLabel,
  weeklyPointsLabel,
} from "./override-errors.ts";

describe("mapCommissionerOverrideError", () => {
  it("maps reuse conflicts with week number", () => {
    assert.equal(
      mapCommissionerOverrideError({
        message: "Team already used by this player in week 4",
        details: "conflicting_week_number=4",
        code: "23514",
      }),
      "That team was already used in Week 4. Clear or change that week first.",
    );
  });

  it("maps blank reason", () => {
    assert.match(
      mapCommissionerOverrideError({ message: "Override reason is required" }),
      /reason/i,
    );
  });

  it("maps bye teams", () => {
    assert.match(
      mapCommissionerOverrideError({
        message: "That team is on bye or not scheduled this week",
      }),
      /bye/i,
    );
  });
});

describe("result helpers", () => {
  it("labels results and points", () => {
    assert.equal(resultLabel("win"), "Win");
    assert.equal(resultLabel(null), "—");
    assert.equal(weeklyPointsLabel("win"), 1);
    assert.equal(weeklyPointsLabel("loss"), 0);
    assert.equal(weeklyPointsLabel(null), 0);
  });
});
