type DbErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

/** Map Supabase/Postgres errors to safe player-facing messages. */
export function mapPickMutationError(error: DbErrorLike | null | undefined): string {
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
    haystack.includes("check_violation")
  ) {
    return "You already used that team earlier this season. Choose a different team.";
  }

  if (
    haystack.includes("week_is_unlocked") ||
    haystack.includes("locks_at") ||
    haystack.includes("row-level security") ||
    haystack.includes("violates row-level security") ||
    error.code === "42501"
  ) {
    return "This week is locked. Picks can no longer be changed.";
  }

  if (
    haystack.includes("picks_unique_week_user") ||
    haystack.includes("duplicate key") ||
    error.code === "23505"
  ) {
    return "You already have a pick for this week. Refresh and try updating it.";
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
