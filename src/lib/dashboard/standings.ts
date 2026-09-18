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

function resultFor(
  picks: DashboardPick[],
  userId: string,
  weekId: string,
): PickResult | "missed" | null {
  const pick = picks.find(
    (candidate) =>
      candidate.userId === userId && candidate.weekId === weekId,
  );

  return pick?.result ?? null;
}

export function buildRegularStandings(
  players: DashboardPlayer[],
  weeks: DashboardWeek[],
  picks: DashboardPick[],
  rules: DashboardRules,
  playoffPointsByUser: ReadonlyMap<string, number> = new Map(),
): Standing[] {
  const orderedWeeks = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  const resolvedWeeks = orderedWeeks.filter((week) => week.status === "final");

  return players
    .map((player) => {
      let wins = 0;
      let losses = 0;
      let ties = 0;
      let missed = 0;
      let currentStreak = 0;
      let longestStreak = 0;

      for (const week of resolvedWeeks) {
        const result = resultFor(picks, player.userId, week.id) ?? "missed";
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

      const survivorAlive = losses === 0 && ties === 0 && missed === 0;
      const playoffPoints = playoffPointsByUser.get(player.userId) ?? 0;
      const pointsEarned = wins * rules.regularPickPoints + playoffPoints;
      const unresolvedRegularWeeks = Math.max(
        0,
        orderedWeeks.length - resolvedWeeks.length,
      );
      const possibleBonuses =
        rules.bestRecordBonus +
        rules.longestStreakBonus +
        (survivorAlive ? rules.survivorBonus : 0);

      return {
        userId: player.userId,
        displayName: player.displayName,
        wins,
        losses,
        ties,
        missed,
        longestStreak,
        currentStreak,
        survivorAlive,
        pointsEarned,
        maxPossible:
          pointsEarned +
          unresolvedRegularWeeks * rules.regularPickPoints +
          possibleBonuses +
          Math.max(0, rules.playoffMaximum - playoffPoints),
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

