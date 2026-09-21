import type { WeekStatus } from "../database.types.ts";

export type StandingsMode =
  | "historical"
  | "live"
  | "current_as_of"
  | "preseason";

export type StandingsView = {
  /** Inclusive week number used as the standings cutoff; null when preseason. */
  standingsThroughWeek: number | null;
  standingsMode: StandingsMode;
  title: string;
  subtitle: string | null;
};

export type StandingsWeekRef = {
  weekNumber: number;
  /** Prefer resolveStandingsWeekStatus output (signal-aware). */
  status: WeekStatus | "upcoming" | "open" | "locked" | "final";
};

function isWeekFullyScored(status: StandingsWeekRef["status"]): boolean {
  return status === "final";
}

/**
 * Resolve which cumulative standings cutoff and heading to show for a
 * selected week relative to the effective current competition week.
 *
 * - Past completed week → historical snapshot through that week
 * - Current in-progress week → live through that week (graded picks only)
 * - Future week → current/live standings as of effective current week
 */
export function resolveStandingsView(args: {
  selectedWeekNumber: number;
  effectiveCurrentWeekNumber: number | null;
  weeks: StandingsWeekRef[];
}): StandingsView {
  const { selectedWeekNumber, effectiveCurrentWeekNumber, weeks } = args;
  const byNumber = new Map(weeks.map((week) => [week.weekNumber, week]));
  const selected = byNumber.get(selectedWeekNumber) ?? null;

  const latestScoredWeek = [...weeks]
    .filter((week) => isWeekFullyScored(week.status))
    .sort((a, b) => b.weekNumber - a.weekNumber)[0]?.weekNumber ?? null;

  const hasAnyDeterminedOrOpen = weeks.some(
    (week) =>
      isWeekFullyScored(week.status) ||
      week.status === "open" ||
      week.status === "locked",
  );

  if (!hasAnyDeterminedOrOpen && latestScoredWeek == null) {
    return {
      standingsThroughWeek: null,
      standingsMode: "preseason",
      title: "Standings (season not started)",
      subtitle: null,
    };
  }

  // Future week while a current week exists: show as-of current.
  if (
    effectiveCurrentWeekNumber != null &&
    selectedWeekNumber > effectiveCurrentWeekNumber
  ) {
    return {
      standingsThroughWeek: effectiveCurrentWeekNumber,
      standingsMode: "current_as_of",
      title: `Current standings through Week ${effectiveCurrentWeekNumber}`,
      subtitle: `Viewing Week ${selectedWeekNumber}`,
    };
  }

  // Selected week is the effective current week (in progress or locked).
  if (
    effectiveCurrentWeekNumber != null &&
    selectedWeekNumber === effectiveCurrentWeekNumber
  ) {
    const current = byNumber.get(effectiveCurrentWeekNumber);
    if (current && isWeekFullyScored(current.status)) {
      return {
        standingsThroughWeek: selectedWeekNumber,
        standingsMode: "historical",
        title: `Standings through Week ${selectedWeekNumber}`,
        subtitle: null,
      };
    }
    return {
      standingsThroughWeek: selectedWeekNumber,
      standingsMode: "live",
      title: `Live standings through Week ${selectedWeekNumber}`,
      subtitle: "Includes completed games so far",
    };
  }

  // Selected week is in the past relative to effective current, or no current
  // week remains (season complete / between weeks).
  if (
    effectiveCurrentWeekNumber == null ||
    selectedWeekNumber < effectiveCurrentWeekNumber
  ) {
    // Prefer the selected week when it has been fully scored; otherwise fall
    // back to the latest fully scored week at or before selection.
    const selectedIsScored =
      selected != null && isWeekFullyScored(selected.status);
    const through = selectedIsScored
      ? selectedWeekNumber
      : ([...weeks]
          .filter(
            (week) =>
              week.weekNumber <= selectedWeekNumber &&
              isWeekFullyScored(week.status),
          )
          .sort((a, b) => b.weekNumber - a.weekNumber)[0]?.weekNumber ?? null);

    if (through == null) {
      return {
        standingsThroughWeek: null,
        standingsMode: "preseason",
        title: "Standings (no completed weeks yet)",
        subtitle: null,
      };
    }

    return {
      standingsThroughWeek: through,
      standingsMode: "historical",
      title: `Standings through Week ${through}`,
      subtitle: null,
    };
  }

  // Fallback — treat as live through selection.
  return {
    standingsThroughWeek: selectedWeekNumber,
    standingsMode: "live",
    title: `Live standings through Week ${selectedWeekNumber}`,
    subtitle: "Includes completed games so far",
  };
}

/**
 * @deprecated Prefer resolveStandingsView. Kept for callers that only need the
 * latest fully-scored week at or before selection (historical-only).
 */
export function resolveStandingsCutoffWeekNumber(
  selectedWeekNumber: number,
  weeks: Array<{ weekNumber: number; status: WeekStatus }>,
): number | null {
  return resolveStandingsView({
    selectedWeekNumber,
    effectiveCurrentWeekNumber: null,
    weeks,
  }).standingsThroughWeek;
}

/** @deprecated Prefer resolveStandingsView().title */
export function standingsCutoffLabel(cutoffWeekNumber: number | null): string {
  if (cutoffWeekNumber == null) {
    return "Standings (no completed weeks yet)";
  }
  return `Standings through Week ${cutoffWeekNumber}`;
}
