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

/**
 * Prefer NFL game terminal status when schedule signals exist.
 * Stored week status is the fallback when games are not synced yet.
 * Pending pick results are never treated as misses by the standings builder.
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
  playoffPointsByUser: ReadonlyMap<string, number>,
  playoffAliveByUser: ReadonlyMap<string, boolean>,
): PlayerTallies {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let missed = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let unresolvedRegularWeeks = 0;

  for (const week of orderedWeeks) {
    if (week.status !== "final") {
      unresolvedRegularWeeks += 1;
      continue;
    }

    const result = resultFor(picks, player.userId, week.id);
    if (result === "pending") {
      // Games may be terminal before auto/commissioner grading finishes.
      unresolvedRegularWeeks += 1;
      continue;
    }

    if (result === "win") {
      wins += 1;
      currentStreak += 1;
      longestStreak = Math.max(longestStreak, currentStreak);
    } else {
      currentStreak = 0;
      if (result === "loss") losses += 1;
      else if (result === "tie") ties += 1;
      else missed += 1;
    }
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
    playoffPoints: playoffPointsByUser.get(player.userId) ?? 0,
    playoffAlive: playoffAliveByUser.get(player.userId) ?? true,
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
  playoffPointsByUser: ReadonlyMap<string, number> = new Map(),
  playoffAliveByUser: ReadonlyMap<string, boolean> = new Map(),
): Standing[] {
  const orderedWeeks = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  const tallies = players.map((player) =>
    tallyPlayer(
      player,
      orderedWeeks,
      picks,
      playoffPointsByUser,
      playoffAliveByUser,
    ),
  );

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
        // Tied survivors each receive the full regular-survivor bonus.
        if (player.survivorAlive) {
          bonusPoints += rules.survivorBonus;
        }
      }

      const pointsEarned = regularPoints + bonusPoints + player.playoffPoints;
      const playoffRemaining = player.playoffAlive
        ? Math.max(0, rules.playoffMaximum - player.playoffPoints)
        : 0;

      let possibleBonuses = 0;
      if (regularSeasonFullyScored) {
        possibleBonuses = 0;
      } else {
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
        if (player.survivorAlive) {
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
