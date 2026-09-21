/** Canonical dashboard information hierarchy (header lives outside). */
export const DASHBOARD_SECTION_ORDER = [
  "week_selector",
  "summary_metrics",
  "standings",
  "league_picks_results",
  "your_pick",
] as const;

export type DashboardSectionId = (typeof DASHBOARD_SECTION_ORDER)[number];

export function dashboardSectionIndex(id: DashboardSectionId): number {
  return DASHBOARD_SECTION_ORDER.indexOf(id);
}

/** True when section A must render before section B. */
export function dashboardSectionPrecedes(
  earlier: DashboardSectionId,
  later: DashboardSectionId,
): boolean {
  return dashboardSectionIndex(earlier) < dashboardSectionIndex(later);
}
