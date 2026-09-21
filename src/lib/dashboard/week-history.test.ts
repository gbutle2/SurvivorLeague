import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  survivorAliveThroughWeek,
  weeklyPointsForResult,
} from "./week-history.ts";

describe("survivorAliveThroughWeek", () => {
  const weeks = [
    { id: "w1", weekNumber: 1, status: "final" },
    { id: "w2", weekNumber: 2, status: "final" },
    { id: "w3", weekNumber: 3, status: "open" },
  ];

  it("marks a player out after a graded loss", () => {
    assert.equal(
      survivorAliveThroughWeek(
        "a",
        weeks,
        [
          { userId: "a", weekId: "w1", result: "win" },
          { userId: "a", weekId: "w2", result: "loss" },
        ],
        2,
      ),
      false,
    );
  });

  it("keeps pending weeks from eliminating", () => {
    assert.equal(
      survivorAliveThroughWeek(
        "a",
        weeks,
        [
          { userId: "a", weekId: "w1", result: "win" },
          { userId: "a", weekId: "w2", result: "win" },
        ],
        3,
      ),
      true,
    );
  });
});

describe("weeklyPointsForResult", () => {
  it("awards points only for wins", () => {
    assert.equal(weeklyPointsForResult("win", 1), 1);
    assert.equal(weeklyPointsForResult("loss", 1), 0);
    assert.equal(weeklyPointsForResult(null, 1), 0);
  });
});
