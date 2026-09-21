/** Team summary for collapsed Your Pick when options may omit the saved team. */
export type SavedPickSummary = {
  teamId: string;
  abbreviation: string;
  city: string;
  name: string;
  opponentAbbreviation: string | null;
  homeAway: "home" | "away" | null;
  kickoffAt: string | null;
};

export function buildSavedPickSummary(args: {
  teamId: string;
  game: {
    id: string;
    scheduled_kickoff_at: string;
    home_team_id: string;
    away_team_id: string;
    home: { id: string; abbreviation: string; city: string; name: string };
    away: { id: string; abbreviation: string; city: string; name: string };
  } | null;
  /** Fallback team row when the game cannot be resolved. */
  team?: {
    id: string;
    abbreviation: string;
    city: string;
    name: string;
  } | null;
}): SavedPickSummary | null {
  if (args.game) {
    const isHome = args.game.home_team_id === args.teamId;
    const team = isHome ? args.game.home : args.game.away;
    const opponent = isHome ? args.game.away : args.game.home;
    return {
      teamId: args.teamId,
      abbreviation: team.abbreviation,
      city: team.city,
      name: team.name,
      opponentAbbreviation: opponent.abbreviation,
      homeAway: isHome ? "home" : "away",
      kickoffAt: args.game.scheduled_kickoff_at,
    };
  }
  if (args.team) {
    return {
      teamId: args.teamId,
      abbreviation: args.team.abbreviation,
      city: args.team.city,
      name: args.team.name,
      opponentAbbreviation: null,
      homeAway: null,
      kickoffAt: null,
    };
  }
  return null;
}
