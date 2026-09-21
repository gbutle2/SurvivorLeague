import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveStandingsView } from "./standings-view.ts";

const weeksW1FinalW2Open = [
  { weekNumber: 1, status: "final" as const },
  { weekNumber: 2, status: "open" as const },
  { weekNumber: 3, status: "upcoming" as const },
];

describe("resolveStandingsView", () => {
  it("shows historical snapshot for a completed past week", () => {
    const view = resolveStandingsView({
      selectedWeekNumber: 1,
      effectiveCurrentWeekNumber: 2,
      weeks: weeksW1FinalW2Open,
    });
    assert.equal(view.standingsMode, "historical");
    assert.equal(view.standingsThroughWeek, 1);
    assert.equal(view.title, "Standings through Week 1");
    assert.equal(view.subtitle, null);
  });

  it("shows live standings for the in-progress current week", () => {
    const view = resolveStandingsView({
      selectedWeekNumber: 2,
      effectiveCurrentWeekNumber: 2,
      weeks: weeksW1FinalW2Open,
    });
    assert.equal(view.standingsMode, "live");
    assert.equal(view.standingsThroughWeek, 2);
    assert.equal(view.title, "Live standings through Week 2");
    assert.equal(view.subtitle, "Includes completed games so far");
  });

  it("shows current-as-of for a future selected week", () => {
    const view = resolveStandingsView({
      selectedWeekNumber: 3,
      effectiveCurrentWeekNumber: 2,
      weeks: weeksW1FinalW2Open,
    });
    assert.equal(view.standingsMode, "current_as_of");
    assert.equal(view.standingsThroughWeek, 2);
    assert.equal(view.title, "Current standings through Week 2");
    assert.equal(view.subtitle, "Viewing Week 3");
  });

  it("does not claim Week 3 standings before Week 3 results exist", () => {
    const view = resolveStandingsView({
      selectedWeekNumber: 3,
      effectiveCurrentWeekNumber: 2,
      weeks: weeksW1FinalW2Open,
    });
    assert.doesNotMatch(view.title, /through Week 3/);
  });

  it("uses historical wording when the selected week is fully scored", () => {
    const view = resolveStandingsView({
      selectedWeekNumber: 2,
      effectiveCurrentWeekNumber: null,
      weeks: [
        { weekNumber: 1, status: "final" },
        { weekNumber: 2, status: "final" },
      ],
    });
    assert.equal(view.standingsMode, "historical");
    assert.equal(view.title, "Standings through Week 2");
  });

  it("returns preseason when nothing has started", () => {
    const view = resolveStandingsView({
      selectedWeekNumber: 1,
      effectiveCurrentWeekNumber: null,
      weeks: [{ weekNumber: 1, status: "upcoming" }],
    });
    assert.equal(view.standingsMode, "preseason");
    assert.equal(view.standingsThroughWeek, null);
  });
});
