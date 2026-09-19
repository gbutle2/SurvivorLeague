import type { WeekStatus } from "@/lib/database.types";

/** Terminal NFL game statuses — matches schedule-query / current-week signals. */
export const TERMINAL_GAME_STATUSES = ["final", "canceled"] as const;

export type WeekFinalCoverage = {
  weekNumber: number;
  storedStatus: WeekStatus;
  /** All regular-season game rows for this week (including canceled). */
  gameCount: number;
  /** Games that are not final/canceled. */
  nonTerminalCount: number;
};

/**
 * Whether stored `weeks.status` should become `final`.
 *
 * NFL game rows are authoritative. Missing schedule coverage (zero games) or
 * any nonterminal game blocks finalization. Already-final weeks are no-ops.
 */
export function shouldReconcileWeekToFinal(input: WeekFinalCoverage): boolean {
  if (input.storedStatus === "final") {
    return false;
  }
  if (input.gameCount <= 0) {
    return false;
  }
  if (input.nonTerminalCount > 0) {
    return false;
  }
  return (
    input.storedStatus === "upcoming" ||
    input.storedStatus === "open" ||
    input.storedStatus === "locked"
  );
}

export function planRegularWeekFinalizations(
  weeks: readonly WeekFinalCoverage[],
): number[] {
  return weeks
    .filter(shouldReconcileWeekToFinal)
    .map((week) => week.weekNumber)
    .sort((a, b) => a - b);
}

type Queryable = {
  query: (
    sql: string,
    params?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
};

/**
 * Idempotently set regular-season weeks to `final` when every stored NFL game
 * for that week is terminal. Never downgrades locked/final weeks. Does not
 * touch picks, games, or playoff rounds.
 */
export async function reconcileRegularWeekFinalStatuses(
  client: Queryable,
  seasonYear: number,
): Promise<{ finalizedWeekNumbers: number[] }> {
  const result = await client.query(
    `UPDATE public.weeks AS w
     SET status = 'final'
     FROM public.seasons AS s
     WHERE w.season_id = s.id
       AND s.year = $1
       AND w.status IN ('upcoming', 'open', 'locked')
       AND EXISTS (
         SELECT 1
         FROM public.games AS g
         WHERE g.season_year = s.year
           AND g.season_type = 'regular'
           AND g.regular_week_number = w.week_number
       )
       AND NOT EXISTS (
         SELECT 1
         FROM public.games AS g
         WHERE g.season_year = s.year
           AND g.season_type = 'regular'
           AND g.regular_week_number = w.week_number
           AND g.status NOT IN ('final', 'canceled')
       )
     RETURNING w.week_number`,
    [seasonYear],
  );

  const finalizedWeekNumbers = result.rows
    .map((row) => Number(row.week_number))
    .filter((weekNumber) => Number.isFinite(weekNumber))
    .sort((a, b) => a - b);

  return { finalizedWeekNumbers };
}
