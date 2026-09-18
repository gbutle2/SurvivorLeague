import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildRegularStandings,
  isPlayoffSurvivorAlive,
  resolveStandingsRoundStatus,
  resolveStandingsWeekStatus,
  resolveSurvivorDecision,
  type DashboardPlayoffPick,
  type DashboardPlayoffRound,
} from "./standings.ts";
import {
  isPerfectRegularSeason,
  overallMaximumPoints,
} from "../scoring/rules.test.ts";

const players = [
  { userId: "a", displayName: "A" },
  { userId: "b", displayName: "B" },
  { userId: "c", displayName: "C" },
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

describe("greatest-weeks survivor resolution", () => {
  it("awards every 18-0 player the full survivor bonus", () => {
    const weeks = [
      { id: "w1", weekNumber: 1, status: "final" as const },
      { id: "w2", weekNumber: 2, status: "final" as const },
    ];
    const picks = [
      { userId: "a", weekId: "w1", result: "win" as const },
      { userId: "b", weekId: "w1", result: "win" as const },
      { userId: "a", weekId: "w2", result: "win" as const },
      { userId: "b", weekId: "w2", result: "win" as const },
    ];
    const decision = resolveSurvivorDecision(
      [players[0]!, players[1]!],
      weeks,
      picks,
    );
    assert.equal(decision.decided, true);
    assert.deepEqual([...decision.winnerUserIds].sort(), ["a", "b"]);
    assert.equal(decision.weeksSurvivedByUser.get("a"), 2);
  });

  it("awards the longest survivor streak when nobody finishes undefeated", () => {
    const weeks = [
      { id: "w1", weekNumber: 1, status: "final" as const },
      { id: "w2", weekNumber: 2, status: "final" as const },
      { id: "w3", weekNumber: 3, status: "final" as const },
    ];
    const picks = [
      { userId: "a", weekId: "w1", result: "win" as const },
      { userId: "b", weekId: "w1", result: "win" as const },
      { userId: "a", weekId: "w2", result: "win" as const },
      { userId: "b", weekId: "w2", result: "loss" as const },
      { userId: "a", weekId: "w3", result: "loss" as const },
      { userId: "b", weekId: "w3", result: "win" as const },
    ];
    const decision = resolveSurvivorDecision(
      [players[0]!, players[1]!],
      weeks,
      picks,
    );
    assert.equal(decision.decided, true);
    assert.deepEqual(decision.winnerUserIds, ["a"]);
    assert.equal(decision.weeksSurvivedByUser.get("a"), 2);
    assert.equal(decision.weeksSurvivedByUser.get("b"), 1);

    const standings = buildRegularStandings(
      [players[0]!, players[1]!],
      weeks,
      picks,
      rules,
    );
    const a = standings.find((row) => row.userId === "a");
    const b = standings.find((row) => row.userId === "b");
    assert.equal(a?.pointsEarned, 2 + 4 + 4 + 10);
    assert.equal(b?.pointsEarned, 2 + 4);
    assert.equal(a?.survivorAlive, false);
  });

  it("keeps an already-earned greatest-weeks bonus after later required losses", () => {
    const weeks = [
      { id: "w1", weekNumber: 1, status: "final" as const },
      { id: "w2", weekNumber: 2, status: "final" as const },
      { id: "w3", weekNumber: 3, status: "final" as const },
      { id: "w4", weekNumber: 4, status: "open" as const },
    ];
    // A survived 2 weeks; B survived 1. After week 3, A already owns the max
    // locked floor (2) and B cannot catch. Later losses must not remove it.
    const picks = [
      { userId: "a", weekId: "w1", result: "win" as const },
      { userId: "b", weekId: "w1", result: "win" as const },
      { userId: "a", weekId: "w2", result: "win" as const },
      { userId: "b", weekId: "w2", result: "loss" as const },
      { userId: "a", weekId: "w3", result: "loss" as const },
    ];
    const decision = resolveSurvivorDecision(
      [players[0]!, players[1]!],
      weeks,
      picks,
    );
    assert.equal(decision.decided, true);
    assert.deepEqual(decision.winnerUserIds, ["a"]);

    const [standing] = buildRegularStandings(
      [players[0]!, players[1]!],
      weeks,
      picks,
      rules,
    );
    assert.equal(standing?.pointsEarned, 2 + 10);
    assert.equal(standing?.survivorAlive, false);
  });

  it("awards greatest weeks survived even if another player was sole survivor earlier", () => {
    const weeks = [
      { id: "w1", weekNumber: 1, status: "final" as const },
      { id: "w2", weekNumber: 2, status: "final" as const },
      { id: "w3", weekNumber: 3, status: "final" as const },
      { id: "w4", weekNumber: 4, status: "final" as const },
    ];
    const picks = [
      { userId: "a", weekId: "w1", result: "win" as const },
      { userId: "b", weekId: "w1", result: "win" as const },
      { userId: "c", weekId: "w1", result: "win" as const },
      { userId: "a", weekId: "w2", result: "win" as const },
      { userId: "b", weekId: "w2", result: "win" as const },
      { userId: "c", weekId: "w2", result: "loss" as const },
      { userId: "a", weekId: "w3", result: "win" as const },
      { userId: "b", weekId: "w3", result: "loss" as const },
      { userId: "a", weekId: "w4", result: "loss" as const },
    ];
    const decision = resolveSurvivorDecision(players, weeks, picks);
    assert.equal(decision.weeksSurvivedByUser.get("a"), 3);
    assert.equal(decision.weeksSurvivedByUser.get("b"), 2);
    assert.deepEqual(decision.winnerUserIds, ["a"]);
  });

  it("ties every player who shares the greatest weeks survived", () => {
    const weeks = [
      { id: "w1", weekNumber: 1, status: "final" as const },
      { id: "w2", weekNumber: 2, status: "final" as const },
    ];
    const picks = [
      { userId: "a", weekId: "w1", result: "win" as const },
      { userId: "b", weekId: "w1", result: "win" as const },
      { userId: "a", weekId: "w2", result: "loss" as const },
      { userId: "b", weekId: "w2", result: "loss" as const },
    ];
    const decision = resolveSurvivorDecision(
      [players[0]!, players[1]!],
      weeks,
      picks,
    );
    assert.deepEqual([...decision.winnerUserIds].sort(), ["a", "b"]);
    const standings = buildRegularStandings(
      [players[0]!, players[1]!],
      weeks,
      picks,
      rules,
    );
    assert.equal(standings[0]?.pointsEarned, 1 + 4 + 4 + 10);
    assert.equal(standings[1]?.pointsEarned, 1 + 4 + 4 + 10);
  });

  it("does not settle while a remaining contender has a pending pick", () => {
    const weeks = [
      { id: "w1", weekNumber: 1, status: "final" as const },
      { id: "w2", weekNumber: 2, status: "final" as const },
    ];
    const picks = [
      { userId: "a", weekId: "w1", result: "win" as const },
      { userId: "b", weekId: "w1", result: "win" as const },
      { userId: "a", weekId: "w2", result: "win" as const },
      { userId: "b", weekId: "w2", result: "pending" as const },
    ];
    const decision = resolveSurvivorDecision(
      [players[0]!, players[1]!],
      weeks,
      picks,
    );
    assert.equal(decision.decided, false);
  });

  it("lets eliminated players keep earning weekly points", () => {
    const weeks = [
      { id: "w1", weekNumber: 1, status: "final" as const },
      { id: "w2", weekNumber: 2, status: "final" as const },
      { id: "w3", weekNumber: 3, status: "final" as const },
    ];
    const picks = [
      { userId: "a", weekId: "w1", result: "win" as const },
      { userId: "b", weekId: "w1", result: "loss" as const },
      { userId: "b", weekId: "w2", result: "win" as const },
      { userId: "b", weekId: "w3", result: "win" as const },
      { userId: "a", weekId: "w2", result: "win" as const },
      { userId: "a", weekId: "w3", result: "win" as const },
    ];
    const standings = buildRegularStandings(
      [players[0]!, players[1]!],
      weeks,
      picks,
      rules,
    );
    const b = standings.find((row) => row.userId === "b");
    assert.equal(b?.wins, 2);
    assert.equal(b?.pointsEarned, 2);
    assert.equal(b?.survivorAlive, false);
  });
});

describe("playoff survivor miss and remaining points", () => {
  const rounds: DashboardPlayoffRound[] = [
    { id: "r1", roundNumber: 1, points: 2, status: "final" },
    { id: "r2", roundNumber: 2, points: 4, status: "open" },
  ];

  it("treats a completed round with no pick as a miss that zeros remaining playoff points", () => {
    assert.equal(isPlayoffSurvivorAlive("a", rounds, []), false);
    const [standing] = buildRegularStandings(
      [players[0]!],
      [{ id: "w1", weekNumber: 1, status: "final" }],
      [{ userId: "a", weekId: "w1", result: "win" }],
      rules,
      rounds,
      [],
    );
    assert.equal(standing?.pointsEarned, 1 + 4 + 4 + 10);
    assert.equal(standing?.maxPossible, standing?.pointsEarned);
  });

  it("does not treat a current incomplete round with no pick as a miss", () => {
    const openOnly: DashboardPlayoffRound[] = [
      { id: "r1", roundNumber: 1, points: 2, status: "open" },
    ];
    assert.equal(isPlayoffSurvivorAlive("a", openOnly, []), true);
  });

  it("does not eliminate on a pending playoff pick", () => {
    const picks: DashboardPlayoffPick[] = [
      {
        userId: "a",
        playoffRoundId: "r1",
        result: "pending",
        pointsAwarded: 0,
      },
    ];
    assert.equal(isPlayoffSurvivorAlive("a", rounds, picks), true);
  });

  it("eliminates on playoff loss and playoff tie", () => {
    assert.equal(
      isPlayoffSurvivorAlive("a", rounds, [
        { userId: "a", playoffRoundId: "r1", result: "loss", pointsAwarded: 0 },
      ]),
      false,
    );
    assert.equal(
      isPlayoffSurvivorAlive("a", rounds, [
        { userId: "a", playoffRoundId: "r1", result: "tie", pointsAwarded: 0 },
      ]),
      false,
    );
  });

  it("keeps a playoff winner alive for later rounds", () => {
    const picks: DashboardPlayoffPick[] = [
      { userId: "a", playoffRoundId: "r1", result: "win", pointsAwarded: 2 },
    ];
    assert.equal(isPlayoffSurvivorAlive("a", rounds, picks), true);
    const [standing] = buildRegularStandings(
      [players[0]!],
      [{ id: "w1", weekNumber: 1, status: "final" }],
      [{ userId: "a", weekId: "w1", result: "win" }],
      rules,
      rounds,
      picks,
    );
    assert.equal(standing?.pointsEarned, 1 + 4 + 4 + 10 + 2);
    assert.equal(standing?.maxPossible, standing!.pointsEarned + 22);
  });

  it("uses stored final status when schedule signals are unavailable", () => {
    assert.equal(resolveStandingsRoundStatus("final", null), "final");
    assert.equal(
      resolveStandingsRoundStatus("locked", { has_non_terminal_game: false }),
      "final",
    );
  });
});

describe("league dashboard standings", () => {
  const weeks = [
    { id: "w1", weekNumber: 1, status: "final" as const },
    { id: "w2", weekNumber: 2, status: "final" as const },
    { id: "w3", weekNumber: 3, status: "open" as const },
  ];

  it("counts wins, streaks, misses, and survivor state", () => {
    const standings = buildRegularStandings(
      [players[0]!, players[1]!],
      weeks,
      [
        { userId: "a", weekId: "w1", result: "win" },
        { userId: "a", weekId: "w2", result: "win" },
        { userId: "b", weekId: "w1", result: "loss" },
      ],
      rules,
    );
    assert.equal(standings[0]?.wins, 2);
    assert.equal(standings[1]?.missed, 1);
  });

  it("keeps unearned record/streak bonuses out of earned until the season is fully scored", () => {
    const [standing] = buildRegularStandings(
      [players[0]!],
      weeks,
      [
        { userId: "a", weekId: "w1", result: "win" },
        { userId: "a", weekId: "w2", result: "win" },
      ],
      rules,
    );
    assert.equal(standing?.pointsEarned, 2 + 10);
    assert.equal(standing?.maxPossible, 2 + 10 + 1 + 4 + 4 + 24);
  });

  it("gives full bonuses to every tied category leader", () => {
    const standings = buildRegularStandings(
      [players[0]!, players[1]!],
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

  it("reaches the 60-point overall maximum components", () => {
    assert.equal(rules.bestRecordBonus, 4);
    assert.equal(rules.longestStreakBonus, 4);
    assert.equal(rules.survivorBonus, 10);
    assert.equal(rules.playoffMaximum, 24);
    assert.equal(overallMaximumPoints(), 60);
  });
});

describe("18-week regular-season competition", () => {
  const eighteenWeeks = Array.from({ length: 18 }, (_, index) => ({
    id: `w${index + 1}`,
    weekNumber: index + 1,
    status: "final" as const,
  }));

  it("counts Week 18 wins toward earned points, record, and streak", () => {
    const picks = eighteenWeeks.map((week) => ({
      userId: "a",
      weekId: week.id,
      result: "win" as const,
    }));
    const [standing] = buildRegularStandings([players[0]!], eighteenWeeks, picks, rules);
    assert.equal(standing?.wins, 18);
    assert.equal(standing?.longestStreak, 18);
    assert.equal(standing?.pointsEarned, 18 + 4 + 4 + 10);
    assert.equal(isPerfectRegularSeason(standing!.wins), true);
    assert.equal(standing?.maxPossible, standing!.pointsEarned + 24);
  });

  it("keeps multiple 18-0 players tied on earned points before playoffs", () => {
    const picks = [
      ...eighteenWeeks.map((week) => ({
        userId: "a",
        weekId: week.id,
        result: "win" as const,
      })),
      ...eighteenWeeks.map((week) => ({
        userId: "b",
        weekId: week.id,
        result: "win" as const,
      })),
    ];
    const standings = buildRegularStandings(
      [players[0]!, players[1]!],
      eighteenWeeks,
      picks,
      rules,
    );
    assert.equal(standings[0]?.pointsEarned, standings[1]?.pointsEarned);
    assert.equal(standings[0]?.pointsEarned, 18 + 4 + 4 + 10);
  });

  it("applies Week 18 loss, tie, and miss to survivor correctly", () => {
    const almostPerfect = eighteenWeeks.slice(0, 17).map((week) => ({
      userId: "a",
      weekId: week.id,
      result: "win" as const,
    }));

    const loss = buildRegularStandings(
      [players[0]!],
      eighteenWeeks,
      [...almostPerfect, { userId: "a", weekId: "w18", result: "loss" }],
      rules,
    )[0];
    assert.equal(loss?.survivorAlive, false);
    assert.equal(loss?.wins, 17);
    assert.equal(loss?.pointsEarned, 17 + 4 + 4 + 10);

    const miss = buildRegularStandings(
      [players[0]!],
      eighteenWeeks,
      almostPerfect,
      rules,
    )[0];
    assert.equal(miss?.missed, 1);
    assert.equal(miss?.survivorAlive, false);
  });

  it("includes unresolved Week 18 in max possible and removes it after resolution", () => {
    const weeksOpen18 = eighteenWeeks.map((week) =>
      week.weekNumber === 18 ? { ...week, status: "open" as const } : week,
    );
    const picks = weeksOpen18
      .filter((week) => week.weekNumber < 18)
      .map((week) => ({
        userId: "a",
        weekId: week.id,
        result: "win" as const,
      }));

    const before = buildRegularStandings([players[0]!], weeksOpen18, picks, rules)[0];
    assert.equal(before?.wins, 17);
    assert.equal(before?.maxPossible, before!.pointsEarned + 1 + 4 + 4 + 24);

    const after = buildRegularStandings(
      [players[0]!],
      eighteenWeeks,
      [...picks, { userId: "a", weekId: "w18", result: "win" }],
      rules,
    )[0];
    assert.equal(after?.wins, 18);
    assert.equal(after?.maxPossible, after!.pointsEarned + 24);
  });
});
