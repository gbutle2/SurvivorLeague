export type PickTeamRef = {
  week_id: string;
  team_id: string;
};

/**
 * Teams already used in the regular season.
 * When changing the current week's pick, exclude that week so the current
 * selection remains selectable.
 */
export function usedTeamIds(
  picks: PickTeamRef[],
  options?: { excludeWeekId?: string | null },
): Set<string> {
  const used = new Set<string>();
  for (const pick of picks) {
    if (options?.excludeWeekId && pick.week_id === options.excludeWeekId) {
      continue;
    }
    used.add(pick.team_id);
  }
  return used;
}

export type TeamAvailabilityStatus = "AVAILABLE" | "USED" | "CURRENT";

export function teamAvailabilityStatus(
  teamId: string,
  usedIds: Set<string>,
  currentTeamId: string | null,
): TeamAvailabilityStatus {
  if (currentTeamId && teamId === currentTeamId) {
    return "CURRENT";
  }
  if (usedIds.has(teamId)) {
    return "USED";
  }
  return "AVAILABLE";
}
