import type { PickResult } from "@/lib/database.types";

export type DashboardWeek = {
  id: string;
  weekNumber: number;
  status: "upcoming" | "open" | "locked" | "final";
};

export type DashboardPick = {
  userId: string;
  weekId: string;
  result: PickResult;
};

export type DashboardPlayer = {
  userId: string;
  displayName: string;
};

export type DashboardRules = {
  regularPickPoints: number;
  bestRecordBonus: number;
  longestStreakBonus: number;
  survivorBonus: number;
  playoffMaximum: number;
};

export type DashboardPlayoffRound = {
  id: string;
  roundNumber: number;
  points: number;
  status: "upcoming" | "open" | "locked" | "final";
};

export type DashboardPlayoffPick = {
  userId: string;
  playoffRoundId: string;
  result: PickResult;
  pointsAwarded: number;
};

export type Standing = {
  userId: string;
  displayName: string;
  wins: number;
  losses: number;
  ties: number;
  missed: number;
  longestStreak: number;
  currentStreak: number;
  survivorAlive: boolean;
  pointsEarned: number;
  maxPossible: number;
};

export type SurvivorDecision = {
  decided: boolean;
  decidedAtWeekNumber: number | null;
  winnerUserIds: readonly string[];
  weeksSurvivedByUser: ReadonlyMap<string, number>;
};

/**
 * Prefer NFL game terminal status when schedule signals exist.
 * Stored week/round status is the fallback when games are not synced yet.
 * Graded pick results (win/loss/tie/miss) count in standings immediately;
 * pending results and missing picks on non-final weeks never count as misses.
 */
export function resolveStandingsWeekStatus(
  weekStatus: DashboardWeek["status"],
  signal: { has_non_terminal_game: boolean } | null | undefined,
): DashboardWeek["status"] {
  if (signal && !signal.has_non_terminal_game) {
    return "final";
  }
  return weekStatus;
}

export function resolveStandingsRoundStatus(
  roundStatus: DashboardPlayoffRound["status"],
  signal: { has_non_terminal_game: boolean } | null | undefined,
): DashboardPlayoffRound["status"] {
  if (signal && !signal.has_non_terminal_game) {
    return "final";
  }
  return roundStatus;
}

function resultFor(
  picks: DashboardPick[],
  userId: string,
  weekId: string,
): PickResult | null {
  const pick = picks.find(
    (candidate) =>
      candidate.userId === userId && candidate.weekId === weekId,
  );

  return pick?.result ?? null;
}

function playoffPickFor(
  picks: DashboardPlayoffPick[],
  userId: string,
  playoffRoundId: string,
): DashboardPlayoffPick | null {
  return (
    picks.find(
      (candidate) =>
        candidate.userId === userId &&
        candidate.playoffRoundId === playoffRoundId,
    ) ?? null
  );
}

type SurvivorRun = {
  userId: string;
  /** Consecutive opening wins already locked in. */
  weeksSurvived: number;
  /** Maximum weeks this player can still reach. */
  ceiling: number;
  /** True once loss/tie/miss ends the run, or every competition week is graded. */
  complete: boolean;
  /** Last week number that contributed to (or ended) the run, when known. */
  decidedAtWeekNumber: number | null;
};

/**
 * Spreadsheet survivor rule (18-week calendar):
 * bonus goes to everyone who survived the greatest number of weeks.
 * 18-0 players each get the full bonus. Pending picks never eliminate or settle.
 */
export function resolveSurvivorDecision(
  players: DashboardPlayer[],
  weeks: DashboardWeek[],
  picks: DashboardPick[],
): SurvivorDecision {
  const orderedWeeks = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  const empty = {
    decided: false,
    decidedAtWeekNumber: null as number | null,
    winnerUserIds: [] as string[],
    weeksSurvivedByUser: new Map<string, number>(),
  };

  if (players.length === 0 || orderedWeeks.length === 0) {
    return empty;
  }

  const runs = players.map((player) =>
    survivorRunFor(player.userId, orderedWeeks, picks),
  );
  const weeksSurvivedByUser = new Map(
    runs.map((run) => [run.userId, run.weeksSurvived]),
  );
  const maxFloor = Math.max(0, ...runs.map((run) => run.weeksSurvived));

  // Zero survival weeks is never an earned survivor result (missing data,
  // pending openers, or everyone already eliminated at week 1).
  if (maxFloor <= 0) {
    return {
      decided: false,
      decidedAtWeekNumber: null,
      winnerUserIds: [],
      weeksSurvivedByUser,
    };
  }

  // Do not settle while any contender can still extend an opening run that
  // reaches the current greatest floor (pending picks or remaining weeks).
  const canStillChange = runs.some(
    (run) => !run.complete && run.ceiling >= maxFloor,
  );
  if (canStillChange) {
    return {
      decided: false,
      decidedAtWeekNumber: null,
      winnerUserIds: [],
      weeksSurvivedByUser,
    };
  }

  const winners = runs
    .filter((run) => run.weeksSurvived === maxFloor)
    .map((run) => run.userId);
  const decidedAtWeekNumber = Math.max(
    0,
    ...runs
      .filter((run) => run.weeksSurvived === maxFloor)
      .map((run) => run.decidedAtWeekNumber ?? 0),
  );

  return {
    decided: true,
    decidedAtWeekNumber: decidedAtWeekNumber || null,
    winnerUserIds: winners,
    weeksSurvivedByUser,
  };
}

function survivorRunFor(
  userId: string,
  orderedWeeks: DashboardWeek[],
  picks: DashboardPick[],
): SurvivorRun {
  let weeksSurvived = 0;
  let decidedAtWeekNumber: number | null = null;

  for (let index = 0; index < orderedWeeks.length; index += 1) {
    const week = orderedWeeks[index]!;
    const remainingIncludingCurrent = orderedWeeks.length - index;
    const result = resultFor(picks, userId, week.id);

    // Graded wins count even while other games that week are still open.
    if (result === "win") {
      weeksSurvived += 1;
      decidedAtWeekNumber = week.weekNumber;
      continue;
    }

    // Graded losses/ties/misses end the run immediately.
    if (result === "loss" || result === "tie" || result === "miss") {
      return {
        userId,
        weeksSurvived,
        ceiling: weeksSurvived,
        complete: true,
        decidedAtWeekNumber: week.weekNumber,
      };
    }

    // Pending picks, or no pick before the week is fully final, never eliminate.
    if (result === "pending" || week.status !== "final") {
      return {
        userId,
        weeksSurvived,
        ceiling: weeksSurvived + remainingIncludingCurrent,
        complete: false,
        decidedAtWeekNumber,
      };
    }

    // Final week with no pick row is a miss.
    return {
      userId,
      weeksSurvived,
      ceiling: weeksSurvived,
      complete: true,
      decidedAtWeekNumber: week.weekNumber,
    };
  }

  return {
    userId,
    weeksSurvived,
    ceiling: weeksSurvived,
    complete: true,
    decidedAtWeekNumber,
  };
}

/**
 * Graded playoff losses/ties/misses eliminate immediately.
 * Pending results do not eliminate. A completed round with no pick is a miss.
 * Missing picks on non-final rounds do not eliminate yet.
 */
export function isPlayoffSurvivorAlive(
  userId: string,
  rounds: DashboardPlayoffRound[],
  picks: DashboardPlayoffPick[],
): boolean {
  const orderedRounds = [...rounds].sort((a, b) => a.roundNumber - b.roundNumber);

  for (const round of orderedRounds) {
    const pick = playoffPickFor(picks, userId, round.id);
    if (pick?.result === "win") {
      continue;
    }
    if (pick && pick.result !== "pending") {
      return false;
    }
    if (pick?.result === "pending") {
      return true;
    }
    if (round.status === "final") {
      return false;
    }
  }

  return true;
}

export function sumPlayoffPointsForUser(
  userId: string,
  picks: DashboardPlayoffPick[],
): number {
  return picks
    .filter((pick) => pick.userId === userId)
    .reduce((sum, pick) => sum + pick.pointsAwarded, 0);
}

type PlayerTallies = {
  userId: string;
  displayName: string;
  wins: number;
  losses: number;
  ties: number;
  missed: number;
  longestStreak: number;
  currentStreak: number;
  survivorAlive: boolean;
  unresolvedRegularWeeks: number;
  playoffPoints: number;
  playoffAlive: boolean;
};

function tallyPlayer(
  player: DashboardPlayer,
  orderedWeeks: DashboardWeek[],
  picks: DashboardPick[],
  playoffPoints: number,
  playoffAlive: boolean,
): PlayerTallies {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let missed = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let unresolvedRegularWeeks = 0;

  for (const week of orderedWeeks) {
    const result = resultFor(picks, player.userId, week.id);

    if (result === "win") {
      wins += 1;
      currentStreak += 1;
      longestStreak = Math.max(longestStreak, currentStreak);
      continue;
    }

    if (result === "loss" || result === "tie" || result === "miss") {
      currentStreak = 0;
      if (result === "loss") losses += 1;
      else if (result === "tie") ties += 1;
      else missed += 1;
      continue;
    }

    // Pending, or no pick before the week is fully final, stays unresolved.
    if (result === "pending" || week.status !== "final") {
      unresolvedRegularWeeks += 1;
      continue;
    }

    // Final week with no pick row is a miss.
    currentStreak = 0;
    missed += 1;
  }

  return {
    userId: player.userId,
    displayName: player.displayName,
    wins,
    losses,
    ties,
    missed,
    longestStreak,
    currentStreak,
    survivorAlive: losses === 0 && ties === 0 && missed === 0,
    unresolvedRegularWeeks,
    playoffPoints,
    playoffAlive,
  };
}

function attainableBestRecordBonus(
  tallies: PlayerTallies[],
  player: PlayerTallies,
  bonus: number,
): number {
  if (bonus <= 0) return 0;
  const leaderWins = Math.max(0, ...tallies.map((entry) => entry.wins));
  const playerCeiling = player.wins + player.unresolvedRegularWeeks;
  return playerCeiling >= leaderWins ? bonus : 0;
}

function attainableLongestStreakBonus(
  tallies: PlayerTallies[],
  player: PlayerTallies,
  bonus: number,
): number {
  if (bonus <= 0) return 0;
  const leaderStreak = Math.max(0, ...tallies.map((entry) => entry.longestStreak));
  const playerCeiling = Math.max(
    player.longestStreak,
    player.currentStreak + player.unresolvedRegularWeeks,
  );
  return playerCeiling >= leaderStreak ? bonus : 0;
}

export function buildRegularStandings(
  players: DashboardPlayer[],
  weeks: DashboardWeek[],
  picks: DashboardPick[],
  rules: DashboardRules,
  playoffRounds: DashboardPlayoffRound[] = [],
  playoffPicks: DashboardPlayoffPick[] = [],
): Standing[] {
  const orderedWeeks = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  const survivor = resolveSurvivorDecision(players, orderedWeeks, picks);
  const survivorWinners = new Set(survivor.winnerUserIds);
  const runs = players.map((player) =>
    survivorRunFor(player.userId, orderedWeeks, picks),
  );
  const maxSurvivorFloor = Math.max(0, ...runs.map((run) => run.weeksSurvived));

  const tallies = players.map((player) => {
    const playoffPoints = sumPlayoffPointsForUser(player.userId, playoffPicks);
    const playoffAlive = isPlayoffSurvivorAlive(
      player.userId,
      playoffRounds,
      playoffPicks,
    );
    return tallyPlayer(
      player,
      orderedWeeks,
      picks,
      playoffPoints,
      playoffAlive,
    );
  });

  const regularSeasonFullyScored =
    orderedWeeks.length > 0 &&
    orderedWeeks.every((week) => week.status === "final") &&
    tallies.every((player) => player.unresolvedRegularWeeks === 0);

  const bestWins = Math.max(0, ...tallies.map((entry) => entry.wins));
  const bestStreak = Math.max(0, ...tallies.map((entry) => entry.longestStreak));

  return tallies
    .map((player) => {
      const regularPoints = player.wins * rules.regularPickPoints;
      let bonusPoints = 0;

      if (regularSeasonFullyScored && tallies.length > 0) {
        if (player.wins === bestWins) {
          bonusPoints += rules.bestRecordBonus;
        }
        if (player.longestStreak === bestStreak) {
          bonusPoints += rules.longestStreakBonus;
        }
      }

      if (survivor.decided && survivorWinners.has(player.userId)) {
        bonusPoints += rules.survivorBonus;
      }

      const pointsEarned = regularPoints + bonusPoints + player.playoffPoints;
      const playoffRemaining = player.playoffAlive
        ? Math.max(0, rules.playoffMaximum - player.playoffPoints)
        : 0;

      let possibleBonuses = 0;
      if (!regularSeasonFullyScored) {
        possibleBonuses += attainableBestRecordBonus(
          tallies,
          player,
          rules.bestRecordBonus,
        );
        possibleBonuses += attainableLongestStreakBonus(
          tallies,
          player,
          rules.longestStreakBonus,
        );
      }

      if (!survivor.decided) {
        const run = runs.find((entry) => entry.userId === player.userId);
        if (run && run.ceiling >= maxSurvivorFloor) {
          possibleBonuses += rules.survivorBonus;
        }
      }

      return {
        userId: player.userId,
        displayName: player.displayName,
        wins: player.wins,
        losses: player.losses,
        ties: player.ties,
        missed: player.missed,
        longestStreak: player.longestStreak,
        currentStreak: player.currentStreak,
        survivorAlive: player.survivorAlive,
        pointsEarned,
        maxPossible:
          pointsEarned +
          player.unresolvedRegularWeeks * rules.regularPickPoints +
          possibleBonuses +
          playoffRemaining,
      };
    })
    .sort(
      (a, b) =>
        b.pointsEarned - a.pointsEarned ||
        b.wins - a.wins ||
        b.longestStreak - a.longestStreak ||
        a.displayName.localeCompare(b.displayName),
    );
}
