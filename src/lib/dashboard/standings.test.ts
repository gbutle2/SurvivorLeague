import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRegularStandings,
  resolveStandingsWeekStatus,
} from "./standings.ts";

const players = [
  { userId: "a", displayName: "A" },
  { userId: "b", displayName: "B" },
];
const weeks = [
  { id: "w1", weekNumber: 1, status: "final" as const },
  { id: "w2", weekNumber: 2, status: "final" as const },
  { id: "w3", weekNumber: 3, status: "open" as const },
];
const rules = {
  regularPickPoints: 1,
  bestRecordBonus: 4,
  longestStreakBonus: 4,
  survivorBonus: 10,
  playoffMaximum: 24,
};

describe("resolveStandingsWeekStatus", () => {
  it("uses NFL terminal games as the authority when signals exist", () => {
    assert.equal(
      resolveStandingsWeekStatus("locked", { has_non_terminal_game: false }),
      "final",
    );
    assert.equal(
      resolveStandingsWeekStatus("locked", { has_non_terminal_game: true }),
      "locked",
    );
  });

  it("falls back to stored week status without signals", () => {
    assert.equal(resolveStandingsWeekStatus("open", null), "open");
    assert.equal(resolveStandingsWeekStatus("final", undefined), "final");
  });
});

describe("league dashboard standings", () => {
  it("counts wins, streaks, misses, and survivor state", () => {
    const standings = buildRegularStandings(
      players,
      weeks,
      [
        { userId: "a", weekId: "w1", result: "win" },
        { userId: "a", weekId: "w2", result: "win" },
        { userId: "b", weekId: "w1", result: "loss" },
      ],
      rules,
    );

    assert.deepEqual(
      standings.map(
        ({ userId, wins, losses, missed, longestStreak, survivorAlive }) => ({
          userId,
          wins,
          losses,
          missed,
          longestStreak,
          survivorAlive,
        }),
      ),
      [
        {
          userId: "a",
          wins: 2,
          losses: 0,
          missed: 0,
          longestStreak: 2,
          survivorAlive: true,
        },
        {
          userId: "b",
          wins: 0,
          losses: 1,
          missed: 1,
          longestStreak: 0,
          survivorAlive: false,
        },
      ],
    );
  });

  it("keeps unearned bonuses out of earned points and includes reachable ones in the ceiling", () => {
    const [standing] = buildRegularStandings(
      [players[0]!],
      weeks,
      [
        { userId: "a", weekId: "w1", result: "win" },
        { userId: "a", weekId: "w2", result: "win" },
      ],
      rules,
      new Map([["a", 6]]),
    );

    assert.equal(standing?.pointsEarned, 8);
    assert.equal(standing?.maxPossible, 45);
  });

  it("treats zero weeks and no picks as empty tallies with bonus/playoff ceiling", () => {
    const [standing] = buildRegularStandings(
      [players[0]!],
      [],
      [],
      rules,
    );

    assert.equal(standing?.wins, 0);
    assert.equal(standing?.pointsEarned, 0);
    assert.equal(standing?.maxPossible, 42);
    assert.equal(standing?.survivorAlive, true);
  });

  it("counts all missed picks against record and survivor", () => {
    const [standing] = buildRegularStandings(
      [players[0]!],
      [
        { id: "w1", weekNumber: 1, status: "final" },
        { id: "w2", weekNumber: 2, status: "final" },
      ],
      [],
      rules,
    );

    assert.equal(standing?.missed, 2);
    assert.equal(standing?.survivorAlive, false);
    // Season is fully scored: tied 0-win / 0-streak leaders still receive those bonuses.
    assert.equal(standing?.pointsEarned, 0 + 4 + 4);
    assert.equal(standing?.maxPossible, 8 + 24);
  });

  it("does not treat pending results as misses while games await grading", () => {
    const [standing] = buildRegularStandings(
      [players[0]!],
      [
        { id: "w1", weekNumber: 1, status: "final" },
        { id: "w2", weekNumber: 2, status: "final" },
      ],
      [
        { userId: "a", weekId: "w1", result: "win" },
        { userId: "a", weekId: "w2", result: "pending" },
      ],
      rules,
    );

    assert.equal(standing?.wins, 1);
    assert.equal(standing?.missed, 0);
    assert.equal(standing?.survivorAlive, true);
    assert.equal(standing?.pointsEarned, 1);
    assert.equal(standing?.maxPossible, 44);
  });

  it("counts ties as non-wins that break streak and survivor", () => {
    const [standing] = buildRegularStandings(
      [players[0]!],
      [
        { id: "w1", weekNumber: 1, status: "final" },
        { id: "w2", weekNumber: 2, status: "final" },
      ],
      [
        { userId: "a", weekId: "w1", result: "win" },
        { userId: "a", weekId: "w2", result: "tie" },
      ],
      rules,
    );

    assert.equal(standing?.wins, 1);
    assert.equal(standing?.ties, 1);
    assert.equal(standing?.currentStreak, 0);
    assert.equal(standing?.survivorAlive, false);
  });

  it("awards settled bonuses into earned once the regular season is fully scored", () => {
    const standings = buildRegularStandings(
      players,
      [
        { id: "w1", weekNumber: 1, status: "final" },
        { id: "w2", weekNumber: 2, status: "final" },
      ],
      [
        { userId: "a", weekId: "w1", result: "win" },
        { userId: "a", weekId: "w2", result: "win" },
        { userId: "b", weekId: "w1", result: "win" },
        { userId: "b", weekId: "w2", result: "loss" },
      ],
      rules,
    );

    const a = standings.find((row) => row.userId === "a");
    const b = standings.find((row) => row.userId === "b");

    assert.equal(a?.pointsEarned, 2 + 4 + 4 + 10);
    assert.equal(a?.maxPossible, a!.pointsEarned + 24);
    assert.equal(b?.pointsEarned, 1);
    assert.equal(b?.maxPossible, b!.pointsEarned + 24);
  });

  it("gives full bonuses to every tied category leader", () => {
    const standings = buildRegularStandings(
      players,
      [
        { id: "w1", weekNumber: 1, status: "final" },
        { id: "w2", weekNumber: 2, status: "final" },
      ],
      [
        { userId: "a", weekId: "w1", result: "win" },
        { userId: "a", weekId: "w2", result: "win" },
        { userId: "b", weekId: "w1", result: "win" },
        { userId: "b", weekId: "w2", result: "win" },
      ],
      rules,
    );

    assert.equal(standings[0]?.pointsEarned, 2 + 4 + 4 + 10);
    assert.equal(standings[1]?.pointsEarned, 2 + 4 + 4 + 10);
  });

  it("drops mathematically eliminated best-record and streak bonuses from the ceiling", () => {
    const standings = buildRegularStandings(
      players,
      [
        { id: "w1", weekNumber: 1, status: "final" },
        { id: "w2", weekNumber: 2, status: "final" },
        { id: "w3", weekNumber: 3, status: "open" },
      ],
      [
        { userId: "a", weekId: "w1", result: "win" },
        { userId: "a", weekId: "w2", result: "win" },
        { userId: "b", weekId: "w1", result: "loss" },
        { userId: "b", weekId: "w2", result: "loss" },
      ],
      rules,
    );

    const a = standings.find((row) => row.userId === "a");
    const b = standings.find((row) => row.userId === "b");

    assert.equal(a?.maxPossible, 2 + 1 + 4 + 4 + 10 + 24);
    assert.equal(b?.pointsEarned, 0);
    // B can still win the remaining week (1) but cannot catch A's 2 wins or
    // streak of 2, and is already out of survivor.
    assert.equal(b?.maxPossible, 0 + 1 + 0 + 0 + 0 + 24);
  });

  it("zeros remaining playoff points after a playoff-survivor elimination", () => {
    const [standing] = buildRegularStandings(
      [players[0]!],
      weeks,
      [
        { userId: "a", weekId: "w1", result: "win" },
        { userId: "a", weekId: "w2", result: "win" },
      ],
      rules,
      new Map([["a", 2]]),
      new Map([["a", false]]),
    );

    assert.equal(standing?.pointsEarned, 4);
    assert.equal(standing?.maxPossible, 4 + 1 + 4 + 4 + 10 + 0);
  });

  it("does not double-count regular and playoff points in earned totals", () => {
    const [standing] = buildRegularStandings(
      [players[0]!],
      [
        { id: "w1", weekNumber: 1, status: "final" },
        { id: "w2", weekNumber: 2, status: "final" },
      ],
      [
        { userId: "a", weekId: "w1", result: "win" },
        { userId: "a", weekId: "w2", result: "win" },
      ],
      rules,
      new Map([["a", 12]]),
    );

    assert.equal(standing?.pointsEarned, 2 + 4 + 4 + 10 + 12);
  });
});
