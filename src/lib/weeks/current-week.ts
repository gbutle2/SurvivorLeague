import type { WeekStatus } from "@/lib/database.types";
import type { WeekLike } from "./open-week.ts";

export type GameWeekSignal = {
  week_number: number;
  has_non_terminal_game: boolean;
  has_future_kickoff: boolean;
};

export type CurrentWeekResolution<T extends WeekLike> =
  | {
      kind: "actionable";
      week: T;
      picksAllowed: true;
      reason: "effective_current";
      staleExpired: T[];
      multipleOpenWarning: T[];
    }
  | {
      kind: "none";
      picksAllowed: false;
      reason: "season_complete" | "no_weeks";
      staleExpired: T[];
      multipleOpenWarning: T[];
    };

/**
 * Shared resolver matching database effective-current-week semantics from games.
 *
 * Eligible: week has ≥1 non-final/canceled game AND ≥1 future kickoff
 * (scheduled/postponed). Lowest week_number wins.
 * weeks.locks_at / stored open status do not authorize picks.
 */
export function resolveCurrentWeekFromGames<T extends WeekLike>(
  weeks: T[],
  signals: GameWeekSignal[],
): CurrentWeekResolution<T> {
  if (weeks.length === 0) {
    return {
      kind: "none",
      picksAllowed: false,
      reason: "no_weeks",
      staleExpired: [],
      multipleOpenWarning: [],
    };
  }

  const byNumber = new Map(signals.map((s) => [s.week_number, s]));
  const multipleOpenWarning = weeks
    .filter((week) => week.status === ("open" as WeekStatus))
    .sort((a, b) => a.week_number - b.week_number);

  const staleExpired = weeks
    .filter((week) => {
      const signal = byNumber.get(week.week_number);
      return signal?.has_non_terminal_game && !signal.has_future_kickoff;
    })
    .sort((a, b) => a.week_number - b.week_number);

  const eligible = weeks
    .filter((week) => {
      const signal = byNumber.get(week.week_number);
      return Boolean(
        signal?.has_non_terminal_game && signal.has_future_kickoff,
      );
    })
    .sort((a, b) => a.week_number - b.week_number);

  if (eligible.length === 0) {
    return {
      kind: "none",
      picksAllowed: false,
      reason: "season_complete",
      staleExpired,
      multipleOpenWarning,
    };
  }

  return {
    kind: "actionable",
    week: eligible[0]!,
    picksAllowed: true,
    reason: "effective_current",
    staleExpired,
    multipleOpenWarning,
  };
}

/** @deprecated Prefer resolveCurrentWeekFromGames with schedule signals. */
export function resolveCurrentWeek<T extends WeekLike>(
  weeks: T[],
  _now: Date = new Date(),
): CurrentWeekResolution<T> {
  // Compatibility shim: without game signals, no week is actionable.
  void _now;
  if (weeks.length === 0) {
    return {
      kind: "none",
      picksAllowed: false,
      reason: "no_weeks",
      staleExpired: [],
      multipleOpenWarning: [],
    };
  }
  return {
    kind: "none",
    picksAllowed: false,
    reason: "season_complete",
    staleExpired: [],
    multipleOpenWarning: weeks.filter((w) => w.status === "open"),
  };
}

export type PlayoffRoundLike = {
  id: string;
  round_number: number;
  round_code: string | null;
  name: string;
};

export type GameRoundSignal = {
  round_code: string;
  has_non_terminal_game: boolean;
  has_future_kickoff: boolean;
};

export function resolveCurrentPlayoffRound<T extends PlayoffRoundLike>(
  rounds: T[],
  signals: GameRoundSignal[],
): T | null {
  const byCode = new Map(signals.map((s) => [s.round_code, s]));
  const ordered = [...rounds].sort((a, b) => a.round_number - b.round_number);
  for (const round of ordered) {
    if (!round.round_code) continue;
    const signal = byCode.get(round.round_code);
    if (signal?.has_non_terminal_game && signal.has_future_kickoff) {
      return round;
    }
  }
  return null;
}
