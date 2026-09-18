import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveCurrentPlayoffRound,
  resolveCurrentWeekFromGames,
} from "./current-week.ts";

describe("resolveCurrentWeekFromGames", () => {
  it("makes Week 2 current after Week 1 has no future kickoffs", () => {
    const weeks = [
      {
        id: "w1",
        week_number: 1,
        label: "Week 1",
        locks_at: "2026-09-01T17:00:00.000Z",
        status: "upcoming" as const,
      },
      {
        id: "w2",
        week_number: 2,
        label: "Week 2",
        locks_at: "2099-09-14T17:00:00.000Z",
        status: "upcoming" as const,
      },
      {
        id: "w3",
        week_number: 3,
        label: "Week 3",
        locks_at: "2099-09-21T17:00:00.000Z",
        status: "upcoming" as const,
      },
    ];
    const current = resolveCurrentWeekFromGames(weeks, [
      { week_number: 1, has_non_terminal_game: false, has_future_kickoff: false },
      { week_number: 2, has_non_terminal_game: true, has_future_kickoff: true },
      { week_number: 3, has_non_terminal_game: true, has_future_kickoff: true },
    ]);
    assert.equal(current.kind, "actionable");
    if (current.kind === "actionable") {
      assert.equal(current.week.week_number, 2);
    }
  });

  it("advances Week 3 automatically after Week 2 kickoffs pass", () => {
    const weeks = [
      {
        id: "w2",
        week_number: 2,
        label: "Week 2",
        locks_at: "2026-09-08T17:00:00.000Z",
        status: "upcoming" as const,
      },
      {
        id: "w3",
        week_number: 3,
        label: "Week 3",
        locks_at: "2099-09-15T17:00:00.000Z",
        status: "upcoming" as const,
      },
    ];
    const current = resolveCurrentWeekFromGames(weeks, [
      { week_number: 2, has_non_terminal_game: true, has_future_kickoff: false },
      { week_number: 3, has_non_terminal_game: true, has_future_kickoff: true },
    ]);
    assert.equal(current.kind, "actionable");
    if (current.kind === "actionable") {
      assert.equal(current.week.week_number, 3);
    }
  });

  it("does not require a stored open status", () => {
    const weeks = [
      {
        id: "w1",
        week_number: 1,
        label: "Week 1",
        locks_at: "2099-09-07T17:00:00.000Z",
        status: "upcoming" as const,
      },
    ];
    const current = resolveCurrentWeekFromGames(weeks, [
      { week_number: 1, has_non_terminal_game: true, has_future_kickoff: true },
    ]);
    assert.equal(current.kind, "actionable");
  });

  it("supports weeks 1 through 18", () => {
    const weeks = Array.from({ length: 18 }, (_, i) => ({
      id: `w${i + 1}`,
      week_number: i + 1,
      label: `Week ${i + 1}`,
      locks_at: "2099-01-01T00:00:00.000Z",
      status: "upcoming" as const,
    }));
    const signals = weeks.map((w) => ({
      week_number: w.week_number,
      has_non_terminal_game: w.week_number === 18,
      has_future_kickoff: w.week_number === 18,
    }));
    const current = resolveCurrentWeekFromGames(weeks, signals);
    assert.equal(current.kind, "actionable");
    if (current.kind === "actionable") {
      assert.equal(current.week.week_number, 18);
    }
  });
});

describe("resolveCurrentPlayoffRound", () => {
  it("progresses wildcard → divisional → conference → superbowl", () => {
    const rounds = [
      { id: "r1", round_number: 1, round_code: "wildcard", name: "Wild Card" },
      { id: "r2", round_number: 2, round_code: "divisional", name: "Divisional" },
      { id: "r3", round_number: 3, round_code: "conference", name: "Conference" },
      { id: "r4", round_number: 4, round_code: "superbowl", name: "Super Bowl" },
    ];
    const current = resolveCurrentPlayoffRound(rounds, [
      {
        round_code: "wildcard",
        has_non_terminal_game: false,
        has_future_kickoff: false,
      },
      {
        round_code: "divisional",
        has_non_terminal_game: true,
        has_future_kickoff: true,
      },
      {
        round_code: "conference",
        has_non_terminal_game: true,
        has_future_kickoff: true,
      },
      {
        round_code: "superbowl",
        has_non_terminal_game: true,
        has_future_kickoff: true,
      },
    ]);
    assert.equal(current?.round_code, "divisional");
  });
});
