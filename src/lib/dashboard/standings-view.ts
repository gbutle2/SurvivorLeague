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
  /** Prefer resolveStandingsWeekStatus output (signal-aware) for scoring. */
  status: WeekStatus | "upcoming" | "open" | "locked" | "final";
};

/**
 * Authoritative inputs for live vs settled standings week detection.
 * Uses stored week status, schedule signals, and pending pick results — not
 * `effective_current_week_id` (earliest future kickoff).
 */
export type StandingsWeekAuthority = {
  weekNumber: number;
  /** Stored competition week status (not signal-forced). */
  status: WeekStatus;
  signal?: {
    has_non_terminal_game: boolean;
    has_future_kickoff: boolean;
    has_started_game: boolean;
  } | null;
  /** True when any pick for this week still has result = pending. */
  hasPendingPickResults: boolean;
};

/**
 * A week has started for standings when schedule authority shows a kickoff
 * has occurred (or a game is in progress/final). Administrative `open` alone
 * does not count — advance future picks must not start the live standings week.
 */
export function weekHasStartedForStandings(
  week: StandingsWeekAuthority,
): boolean {
  if (week.signal) {
    return week.signal.has_started_game;
  }
  return (
    week.status === "open" ||
    week.status === "locked" ||
    week.status === "final"
  );
}

/**
 * Settled weeks are safe historical snapshots:
 * - formally `final`, or
 * - all games terminal and no picks still awaiting grading.
 */
export function weekIsSettledForStandings(
  week: StandingsWeekAuthority,
): boolean {
  if (week.status === "final") return true;
  const gamesTerminal =
    week.signal != null && !week.signal.has_non_terminal_game;
  return gamesTerminal && !week.hasPendingPickResults;
}

/**
 * Live standings week = earliest week that has started and is not yet settled.
 *
 * Remains live when games are still in progress, or when games are terminal
 * but picks are still pending grading. A later week with the next future
 * kickoff does not become the live cutoff.
 */
export function resolveLiveStandingsWeekNumber(
  weeks: StandingsWeekAuthority[],
): number | null {
  const ordered = [...weeks].sort((a, b) => a.weekNumber - b.weekNumber);
  for (const week of ordered) {
    if (
      weekHasStartedForStandings(week) &&
      !weekIsSettledForStandings(week)
    ) {
      return week.weekNumber;
    }
  }
  return null;
}

export function resolveLatestSettledStandingsWeekNumber(
  weeks: StandingsWeekAuthority[],
): number | null {
  return (
    [...weeks]
      .filter((week) => weekIsSettledForStandings(week))
      .sort((a, b) => b.weekNumber - a.weekNumber)[0]?.weekNumber ?? null
  );
}

function historicalThrough(
  selectedWeekNumber: number,
  weeks: StandingsWeekAuthority[],
): number | null {
  const byNumber = new Map(weeks.map((week) => [week.weekNumber, week]));
  const selected = byNumber.get(selectedWeekNumber) ?? null;
  if (selected && weekIsSettledForStandings(selected)) {
    return selectedWeekNumber;
  }
  return (
    [...weeks]
      .filter(
        (week) =>
          week.weekNumber <= selectedWeekNumber &&
          weekIsSettledForStandings(week),
      )
      .sort((a, b) => b.weekNumber - a.weekNumber)[0]?.weekNumber ?? null
  );
}

/**
 * Resolve which cumulative standings cutoff and heading to show.
 *
 * Authority is `liveStandingsWeekNumber` / settled weeks — not the earliest
 * week with a future kickoff (UI default / pick eligibility helper).
 *
 * - Past settled week → historical snapshot through that week
 * - Live incomplete week → live through that week (graded picks only)
 * - Future / advance-pick week → current-as-of the live (or latest settled) week
 */
export function resolveStandingsView(args: {
  selectedWeekNumber: number;
  liveStandingsWeekNumber: number | null;
  latestSettledWeekNumber: number | null;
  weeks: StandingsWeekAuthority[];
}): StandingsView {
  const {
    selectedWeekNumber,
    liveStandingsWeekNumber,
    latestSettledWeekNumber,
    weeks,
  } = args;

  if (liveStandingsWeekNumber == null && latestSettledWeekNumber == null) {
    return {
      standingsThroughWeek: null,
      standingsMode: "preseason",
      title: "Standings (season not started)",
      subtitle: null,
    };
  }

  // Live competition week still incomplete.
  if (liveStandingsWeekNumber != null) {
    if (selectedWeekNumber > liveStandingsWeekNumber) {
      return {
        standingsThroughWeek: liveStandingsWeekNumber,
        standingsMode: "current_as_of",
        title: `Current standings through Week ${liveStandingsWeekNumber}`,
        subtitle: `Viewing Week ${selectedWeekNumber}`,
      };
    }

    if (selectedWeekNumber === liveStandingsWeekNumber) {
      return {
        standingsThroughWeek: liveStandingsWeekNumber,
        standingsMode: "live",
        title: `Live standings through Week ${liveStandingsWeekNumber}`,
        subtitle: "Includes completed games so far",
      };
    }

    // Selected earlier than live week → historical snapshot.
    const through = historicalThrough(selectedWeekNumber, weeks);
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

  // No live week: season between weeks or fully settled through latestSettled.
  const asOf = latestSettledWeekNumber!;
  if (selectedWeekNumber > asOf) {
    return {
      standingsThroughWeek: asOf,
      standingsMode: "current_as_of",
      title: `Current standings through Week ${asOf}`,
      subtitle: `Viewing Week ${selectedWeekNumber}`,
    };
  }

  const through = historicalThrough(selectedWeekNumber, weeks) ?? asOf;
  return {
    standingsThroughWeek: through,
    standingsMode: "historical",
    title: `Standings through Week ${through}`,
    subtitle: null,
  };
}

/**
 * @deprecated Prefer resolveStandingsView with live/settled authority.
 * Historical-only helper: latest formally final week at or before selection.
 */
export function resolveStandingsCutoffWeekNumber(
  selectedWeekNumber: number,
  weeks: Array<{ weekNumber: number; status: WeekStatus }>,
): number | null {
  const authority: StandingsWeekAuthority[] = weeks.map((week) => ({
    weekNumber: week.weekNumber,
    status: week.status,
    signal: null,
    hasPendingPickResults: false,
  }));
  // Without schedule signals, only stored `final` counts as settled; `open`
  // must not become the live standings week via this historical helper.
  return historicalThrough(selectedWeekNumber, authority);
}

/** @deprecated Prefer resolveStandingsView().title */
export function standingsCutoffLabel(cutoffWeekNumber: number | null): string {
  if (cutoffWeekNumber == null) {
    return "Standings (no completed weeks yet)";
  }
  return `Standings through Week ${cutoffWeekNumber}`;
}
