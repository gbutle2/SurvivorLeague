import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildWeekSelectorOptions,
  parseWeekQueryParam,
  resolveDefaultWeekNumber,
  resolveSelectedWeekNumber,
  resolveStandingsCutoffWeekNumber,
  standingsCutoffLabel,
  weekOptionStatusLabel,
} from "./week-selector.ts";

const weeks = [
  {
    id: "w1",
    week_number: 1,
    label: "Week 1",
    locks_at: "2026-09-10T00:00:00Z",
    status: "final" as const,
  },
  {
    id: "w2",
    week_number: 2,
    label: "Week 2",
    locks_at: "2026-09-17T00:00:00Z",
    status: "final" as const,
  },
  {
    id: "w3",
    week_number: 3,
    label: "Week 3",
    locks_at: "2026-09-24T00:00:00Z",
    status: "upcoming" as const,
  },
  {
    id: "w4",
    week_number: 4,
    label: "Week 4",
    locks_at: "2026-10-01T00:00:00Z",
    status: "upcoming" as const,
  },
];

const signals = [
  { week_number: 1, has_non_terminal_game: false, has_future_kickoff: false },
  { week_number: 2, has_non_terminal_game: false, has_future_kickoff: false },
  { week_number: 3, has_non_terminal_game: true, has_future_kickoff: true },
  { week_number: 4, has_non_terminal_game: true, has_future_kickoff: true },
];

describe("weekOptionStatusLabel", () => {
  it("labels final, in progress, and upcoming weeks", () => {
    assert.equal(
      weekOptionStatusLabel(1, "final", signals[0], 3),
      "Final",
    );
    assert.equal(
      weekOptionStatusLabel(3, "upcoming", signals[2], 3),
      "In progress",
    );
    assert.equal(
      weekOptionStatusLabel(4, "upcoming", signals[3], 3),
      "Upcoming",
    );
    assert.equal(weekOptionStatusLabel(7, "locked", null, 3), "Locked");
  });
});

describe("buildWeekSelectorOptions", () => {
  it("builds option labels for scheduled weeks", () => {
    const options = buildWeekSelectorOptions(weeks, signals, 18, 3);
    assert.equal(options.length, 4);
    assert.equal(options[0]?.optionLabel, "Week 1 — Final");
    assert.equal(options[1]?.optionLabel, "Week 2 — Final");
    assert.equal(options[2]?.optionLabel, "Week 3 — In progress");
    assert.equal(options[3]?.optionLabel, "Week 4 — Upcoming");
  });
});

describe("resolveDefaultWeekNumber", () => {
  it("defaults to the effective current week", () => {
    assert.equal(resolveDefaultWeekNumber(weeks, signals), 3);
  });

  it("falls back to latest completed when season has no future kickoffs", () => {
    const doneSignals = signals.map((s) => ({
      ...s,
      has_non_terminal_game: false,
      has_future_kickoff: false,
    }));
    assert.equal(resolveDefaultWeekNumber(weeks, doneSignals), 4);
  });
});

describe("week query param", () => {
  it("parses valid week numbers and rejects invalid", () => {
    assert.equal(parseWeekQueryParam("3"), 3);
    assert.equal(parseWeekQueryParam(["5"]), 5);
    assert.equal(parseWeekQueryParam("0"), null);
    assert.equal(parseWeekQueryParam("abc"), null);
    assert.equal(parseWeekQueryParam(undefined), null);
  });

  it("falls back when requested week is unavailable", () => {
    assert.equal(resolveSelectedWeekNumber(9, [1, 2, 3, 4], 3), 3);
    assert.equal(resolveSelectedWeekNumber(2, [1, 2, 3, 4], 3), 2);
    assert.equal(resolveSelectedWeekNumber(null, [1, 2], 1), 1);
  });
});

describe("standings cutoff", () => {
  it("uses latest final week at or before selection when no current week", () => {
    const scored = [
      { weekNumber: 1, status: "final" as const },
      { weekNumber: 2, status: "final" as const },
      { weekNumber: 3, status: "open" as const },
      { weekNumber: 5, status: "upcoming" as const },
    ];
    assert.equal(resolveStandingsCutoffWeekNumber(3, scored), 2);
    assert.equal(resolveStandingsCutoffWeekNumber(5, scored), 2);
    assert.equal(resolveStandingsCutoffWeekNumber(1, scored), 1);
    assert.equal(
      resolveStandingsCutoffWeekNumber(3, [
        { weekNumber: 3, status: "upcoming" },
      ]),
      null,
    );
    assert.equal(standingsCutoffLabel(2), "Standings through Week 2");
    assert.equal(
      standingsCutoffLabel(null),
      "Standings (no completed weeks yet)",
    );
  });
});
