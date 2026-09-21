type DbErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

export type PickMutationContext = {
  weekLabel?: string;
  weekNumber?: number;
  conflictWeekNumber?: number | null;
};

/** Map Supabase/Postgres errors to precise, non-conflated player-facing messages. */
export function mapPickMutationError(
  error: DbErrorLike | null | undefined,
  context: PickMutationContext = {},
): string {
  if (!error) {
    return "Something went wrong while saving your pick. Please try again.";
  }

  const haystack = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    haystack.includes("team already used") ||
    haystack.includes("unique_team") ||
    (error.code === "23514" && haystack.includes("team"))
  ) {
    if (context.conflictWeekNumber != null) {
      return `You already used this team in Week ${context.conflictWeekNumber}.`;
    }
    return "You already used this team in another week.";
  }

  if (
    haystack.includes("pick_team_plays_unlocked") ||
    haystack.includes("team_regular_game_is_unlocked") ||
    haystack.includes("kickoff")
  ) {
    return "Your pick is locked because this game has started.";
  }

  if (
    haystack.includes("week_allows_player_picks") ||
    haystack.includes("week_is_unlocked") ||
    haystack.includes("week_is_effective_current")
  ) {
    const label = context.weekLabel ?? "This week";
    return `${label} is closed for picks.`;
  }

  if (haystack.includes("no scheduled") || haystack.includes("bye")) {
    return context.weekNumber != null
      ? `This team is not scheduled for Week ${context.weekNumber}.`
      : "This team is not scheduled for the selected week.";
  }

  if (
    haystack.includes("picks_unique_week_user") ||
    (error.code === "23505" && haystack.includes("duplicate key"))
  ) {
    return "Your pick changed while you were editing. Refresh and try again.";
  }

  if (
    haystack.includes("row-level security") ||
    haystack.includes("violates row-level security") ||
    error.code === "42501"
  ) {
    // RLS can mean locked week, started game, or auth — do not claim kickoff.
    return "Your pick could not be saved. Refresh and try again.";
  }

  if (haystack.includes("network") || haystack.includes("fetch failed")) {
    return "Database unavailable. Check your connection and try again.";
  }

  return "Could not save your pick. Please try again.";
}

export function mapWeekMutationError(error: DbErrorLike | null | undefined): string {
  if (!error) {
    return "Something went wrong while saving the week. Please try again.";
  }

  const haystack = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    haystack.includes("weeks_one_open_per_season_idx") ||
    (error.code === "23505" && haystack.includes("one_open"))
  ) {
    return "Another week is already open. Lock it before opening this week.";
  }

  if (
    haystack.includes("weeks_unique_season_week") ||
    (error.code === "23505" && haystack.includes("weeks_unique_season_week"))
  ) {
    return "That week number already exists for this season.";
  }

  if (error.code === "23505" && haystack.includes("duplicate key")) {
    if (haystack.includes("open")) {
      return "Another week is already open. Lock it before opening this week.";
    }
    return "That week number already exists for this season.";
  }

  if (
    haystack.includes("row-level security") ||
    haystack.includes("violates row-level security") ||
    error.code === "42501"
  ) {
    return "You are not authorized to manage weeks for this league.";
  }

  if (haystack.includes("network") || haystack.includes("fetch failed")) {
    return "Database unavailable. Check your connection and try again.";
  }

  return "Could not save the week. Please try again.";
}

/** Friendly mapping used by tests and callers for the open-week unique index. */
export function mapOpenWeekUniqueViolation(
  error: DbErrorLike | null | undefined,
): string {
  return mapWeekMutationError(
    error ?? {
      code: "23505",
      message: 'duplicate key value violates unique constraint "weeks_one_open_per_season_idx"',
    },
  );
}
