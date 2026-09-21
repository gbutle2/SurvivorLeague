import type { WeekStatus } from "../database.types.ts";
import type { GameWeekSignal } from "./current-week.ts";
import type { WeekLike } from "./open-week.ts";
import { resolveCurrentWeekFromGames } from "./current-week.ts";

export type WeekOptionStatusLabel =
  | "Final"
  | "In progress"
  | "Upcoming"
  | "Locked";

export type WeekSelectorOption = {
  weekId: string;
  weekNumber: number;
  label: string;
  status: WeekStatus;
  statusLabel: WeekOptionStatusLabel;
  hasSchedule: boolean;
  optionLabel: string;
};

export function weekOptionStatusLabel(
  weekNumber: number,
  status: WeekStatus,
  signal: GameWeekSignal | null | undefined,
  effectiveCurrentWeekNumber: number | null,
): WeekOptionStatusLabel {
  if (status === "locked") return "Locked";
  if (status === "final") return "Final";
  if (signal && !signal.has_non_terminal_game) return "Final";
  if (signal && signal.has_non_terminal_game && !signal.has_future_kickoff) {
    return "In progress";
  }
  if (signal?.has_future_kickoff) {
    if (
      effectiveCurrentWeekNumber != null &&
      weekNumber <= effectiveCurrentWeekNumber
    ) {
      return "In progress";
    }
    return "Upcoming";
  }
  if (status === "open") return "In progress";
  return "Upcoming";
}

/**
 * Build selectable regular-season weeks that have schedule data
 * (or are finalized / administratively locked).
 */
export function buildWeekSelectorOptions<T extends WeekLike & { id: string }>(
  weeks: T[],
  signals: GameWeekSignal[],
  regularWeekCount: number,
  effectiveCurrentWeekNumber: number | null = null,
): WeekSelectorOption[] {
  const byNumber = new Map(signals.map((s) => [s.week_number, s]));
  return weeks
    .filter((week) => week.week_number <= regularWeekCount)
    .sort((a, b) => a.week_number - b.week_number)
    .map((week) => {
      const signal = byNumber.get(week.week_number);
      const hasSchedule =
        Boolean(signal) ||
        week.status === "final" ||
        week.status === "locked";
      const statusLabel = weekOptionStatusLabel(
        week.week_number,
        week.status,
        signal,
        effectiveCurrentWeekNumber,
      );
      return {
        weekId: week.id,
        weekNumber: week.week_number,
        label: week.label,
        status: week.status,
        statusLabel,
        hasSchedule,
        optionLabel: `Week ${week.week_number} — ${statusLabel}`,
      };
    })
    .filter((option) => option.hasSchedule);
}

/**
 * Default week: effective current NFL week, else earliest with future kickoff,
 * else latest completed week.
 */
export function resolveDefaultWeekNumber<T extends WeekLike>(
  weeks: T[],
  signals: GameWeekSignal[],
): number | null {
  if (weeks.length === 0) return null;
  const current = resolveCurrentWeekFromGames(weeks, signals);
  if (current.kind === "actionable") {
    return current.week.week_number;
  }

  const byNumber = new Map(signals.map((s) => [s.week_number, s]));
  const withFuture = weeks
    .filter((week) => byNumber.get(week.week_number)?.has_future_kickoff)
    .sort((a, b) => a.week_number - b.week_number);
  if (withFuture[0]) return withFuture[0].week_number;

  const completed = weeks
    .filter((week) => {
      const signal = byNumber.get(week.week_number);
      return (
        week.status === "final" ||
        (signal != null && !signal.has_non_terminal_game)
      );
    })
    .sort((a, b) => b.week_number - a.week_number);
  if (completed[0]) return completed[0].week_number;

  const ordered = [...weeks].sort((a, b) => a.week_number - b.week_number);
  return ordered[ordered.length - 1]?.week_number ?? null;
}

export function parseWeekQueryParam(
  raw: string | string[] | undefined | null,
): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value == null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 18) return null;
  return parsed;
}

export function resolveSelectedWeekNumber(
  requested: number | null,
  availableWeekNumbers: number[],
  defaultWeekNumber: number | null,
): number | null {
  if (availableWeekNumbers.length === 0) return null;
  if (requested != null && availableWeekNumbers.includes(requested)) {
    return requested;
  }
  if (
    defaultWeekNumber != null &&
    availableWeekNumbers.includes(defaultWeekNumber)
  ) {
    return defaultWeekNumber;
  }
  return availableWeekNumbers[availableWeekNumbers.length - 1] ?? null;
}

/**
 * Latest completed (final) week number at or before the selected week.
 * @deprecated Prefer resolveStandingsView from standings-view.ts
 */
export {
  resolveStandingsCutoffWeekNumber,
  standingsCutoffLabel,
} from "../dashboard/standings-view.ts";
