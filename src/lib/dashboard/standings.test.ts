import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildRegularStandings } from "./standings.ts";

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

describe("league dashboard standings", () => {
  it("counts wins, streaks, misses, and survivor state", () => {
    const standings = buildRegularStandings(players, weeks, [
      { userId: "a", weekId: "w1", result: "win" },
      { userId: "a", weekId: "w2", result: "win" },
      { userId: "b", weekId: "w1", result: "loss" },
    ], rules);

    assert.deepEqual(
      standings.map(({ userId, wins, losses, missed, longestStreak, survivorAlive }) => ({
        userId,
        wins,
        losses,
        missed,
        longestStreak,
        survivorAlive,
      })),
      [
        { userId: "a", wins: 2, losses: 0, missed: 0, longestStreak: 2, survivorAlive: true },
        { userId: "b", wins: 0, losses: 1, missed: 1, longestStreak: 0, survivorAlive: false },
      ],
    );
  });

  it("keeps unearned bonuses out of earned points and includes them in the ceiling", () => {
    const [standing] = buildRegularStandings([players[0]!], weeks, [
      { userId: "a", weekId: "w1", result: "win" },
      { userId: "a", weekId: "w2", result: "win" },
    ], rules, new Map([["a", 6]]));

    assert.equal(standing?.pointsEarned, 8);
    assert.equal(standing?.maxPossible, 45);
  });
});
