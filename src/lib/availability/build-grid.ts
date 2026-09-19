import {
  teamAvailabilityStatus,
  usedTeamIds,
  type PickTeamRef,
  type TeamAvailabilityStatus,
} from "../picks/used-teams.ts";

export type AvailabilityTeamRow = {
  id: string;
  abbreviation: string;
  city: string;
  name: string;
  status: TeamAvailabilityStatus;
};

/**
 * Build the availability grid from teams and picks already filtered by RLS.
 * Callers must only pass picks the database allowed the viewer to see.
 */
export function buildAvailabilityGrid(input: {
  teams: ReadonlyArray<{
    id: string;
    abbreviation: string;
    city: string;
    name: string;
  }>;
  /** Visible picks for the selected member only (RLS-filtered). */
  visiblePicks: readonly PickTeamRef[];
  currentWeekId: string | null;
}): AvailabilityTeamRow[] {
  const currentTeamId =
    input.currentWeekId == null
      ? null
      : (input.visiblePicks.find((pick) => pick.week_id === input.currentWeekId)
          ?.team_id ?? null);

  const used = usedTeamIds(input.visiblePicks, {
    excludeWeekId: input.currentWeekId,
  });

  return input.teams.map((team) => ({
    id: team.id,
    abbreviation: team.abbreviation,
    city: team.city,
    name: team.name,
    status: teamAvailabilityStatus(team.id, used, currentTeamId),
  }));
}

/**
 * Assert a server payload does not leak a forbidden team as used/current.
 * Used by tests to lock privacy expectations.
 */
export function availabilityHidesTeam(
  rows: readonly AvailabilityTeamRow[],
  teamId: string,
): boolean {
  const row = rows.find((entry) => entry.id === teamId);
  return row?.status === "AVAILABLE";
}
