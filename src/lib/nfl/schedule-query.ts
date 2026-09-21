export type GameWeekSignal = {
  week_number: number;
  has_non_terminal_game: boolean;
  has_future_kickoff: boolean;
  /** True when any game in the week has kicked off or reached in_progress/final. */
  has_started_game: boolean;
};

export type GameRoundSignal = {
  round_code: string;
  has_non_terminal_game: boolean;
  has_future_kickoff: boolean;
};

type GamesClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string | number,
      ) => PromiseLike<{
        data: Array<Record<string, unknown>> | null;
        error: { message: string } | null;
      }> & {
        eq: (
          column: string,
          value: string | number,
        ) => PromiseLike<{
          data: Array<Record<string, unknown>> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

export async function loadRegularWeekSignals(
  supabase: GamesClient,
  seasonYear: number,
): Promise<{ signals: GameWeekSignal[]; error: string | null }> {
  const { data, error } = await supabase
    .from("games")
    .select("regular_week_number, status, scheduled_kickoff_at")
    .eq("season_year", seasonYear)
    .eq("season_type", "regular");

  if (error) {
    return { signals: [], error: error.message };
  }

  const now = Date.now();
  const byWeek = new Map<
    number,
    {
      has_non_terminal_game: boolean;
      has_future_kickoff: boolean;
      has_started_game: boolean;
    }
  >();

  for (const row of data ?? []) {
    const week = row.regular_week_number as number | null;
    if (week == null) continue;
    const entry = byWeek.get(week) ?? {
      has_non_terminal_game: false,
      has_future_kickoff: false,
      has_started_game: false,
    };
    const status = String(row.status);
    const kickoffMs = new Date(String(row.scheduled_kickoff_at)).getTime();
    if (status !== "final" && status !== "canceled") {
      entry.has_non_terminal_game = true;
    }
    if (
      (status === "scheduled" || status === "postponed") &&
      kickoffMs > now
    ) {
      entry.has_future_kickoff = true;
    }
    if (
      status === "final" ||
      status === "in_progress" ||
      ((status === "scheduled" || status === "postponed") && kickoffMs <= now)
    ) {
      entry.has_started_game = true;
    }
    byWeek.set(week, entry);
  }

  return {
    signals: [...byWeek.entries()].map(([week_number, value]) => ({
      week_number,
      ...value,
    })),
    error: null,
  };
}

export async function loadPlayoffRoundSignals(
  supabase: GamesClient,
  seasonYear: number,
): Promise<{ signals: GameRoundSignal[]; error: string | null }> {
  const { data, error } = await supabase
    .from("games")
    .select("playoff_round, status, scheduled_kickoff_at")
    .eq("season_year", seasonYear)
    .eq("season_type", "postseason");

  if (error) {
    return { signals: [], error: error.message };
  }

  const now = Date.now();
  const byRound = new Map<
    string,
    { has_non_terminal_game: boolean; has_future_kickoff: boolean }
  >();

  for (const row of data ?? []) {
    const code = row.playoff_round as string | null;
    if (!code) continue;
    const entry = byRound.get(code) ?? {
      has_non_terminal_game: false,
      has_future_kickoff: false,
    };
    const status = String(row.status);
    if (status !== "final" && status !== "canceled") {
      entry.has_non_terminal_game = true;
    }
    if (
      (status === "scheduled" || status === "postponed") &&
      new Date(String(row.scheduled_kickoff_at)).getTime() > now
    ) {
      entry.has_future_kickoff = true;
    }
    byRound.set(code, entry);
  }

  return {
    signals: [...byRound.entries()].map(([round_code, value]) => ({
      round_code,
      ...value,
    })),
    error: null,
  };
}

export type PickGameOption = {
  gameId: string;
  teamId: string;
  abbreviation: string;
  city: string;
  name: string;
  opponentAbbreviation: string;
  homeAway: "home" | "away";
  kickoffAt: string;
  status: string;
  used: boolean;
  locked: boolean;
};

export function buildPickGameOptions(args: {
  games: Array<{
    id: string;
    home_team_id: string;
    away_team_id: string;
    scheduled_kickoff_at: string;
    status: string;
    home: { id: string; abbreviation: string; city: string; name: string };
    away: { id: string; abbreviation: string; city: string; name: string };
  }>;
  usedTeamIds: Set<string>;
  /** Team already saved for this week — never marked used against itself. */
  retainTeamId?: string | null;
  now?: Date;
}): PickGameOption[] {
  const now = (args.now ?? new Date()).getTime();
  const options: PickGameOption[] = [];
  const retain = args.retainTeamId ?? null;

  for (const game of args.games) {
    const kickoffMs = new Date(game.scheduled_kickoff_at).getTime();
    // Match DB team_regular_game_is_unlocked: scheduled/postponed and kickoff > now.
    const locked = !(
      (game.status === "scheduled" || game.status === "postponed") &&
      kickoffMs > now
    );

    const sides = [
      {
        team: game.home,
        opponent: game.away,
        homeAway: "home" as const,
      },
      {
        team: game.away,
        opponent: game.home,
        homeAway: "away" as const,
      },
    ];

    for (const side of sides) {
      const isRetained = retain != null && side.team.id === retain;
      options.push({
        gameId: game.id,
        teamId: side.team.id,
        abbreviation: side.team.abbreviation,
        city: side.team.city,
        name: side.team.name,
        opponentAbbreviation: side.opponent.abbreviation,
        homeAway: side.homeAway,
        kickoffAt: game.scheduled_kickoff_at,
        status: game.status,
        used: !isRetained && args.usedTeamIds.has(side.team.id),
        locked,
      });
    }
  }

  return options.sort((a, b) => {
    const kickoff = a.kickoffAt.localeCompare(b.kickoffAt);
    if (kickoff !== 0) return kickoff;
    return a.abbreviation.localeCompare(b.abbreviation);
  });
}

export {
  isExistingPickLocked,
  isGameUnlocked,
  resolveAuthoritativePickGame,
  resolveExistingPickLockState,
} from "../picks/eligibility.ts";
