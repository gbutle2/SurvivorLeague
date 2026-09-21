import type { PickResult } from "@/lib/database.types";

type DbErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

/** Map commissioner override RPC errors to safe UI messages. */
export function mapCommissionerOverrideError(
  error: DbErrorLike | null | undefined,
): string {
  if (!error) {
    return "Could not save the override. Please try again.";
  }

  const haystack = [error.message, error.details, error.hint]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (haystack.includes("reason is required") || haystack.includes("nonblank")) {
    return "Enter a reason for this override.";
  }

  if (haystack.includes("team already used")) {
    const weekMatch = /week\s+(\d+)/i.exec(error.message ?? "");
    const detailMatch = /conflicting_week_number=(\d+)/i.exec(
      `${error.details ?? ""} ${error.hint ?? ""}`,
    );
    const week = weekMatch?.[1] ?? detailMatch?.[1];
    return week
      ? `That team was already used in Week ${week}. Clear or change that week first.`
      : "That team was already used in another regular-season week. Clear or change that week first.";
  }

  if (haystack.includes("on bye") || haystack.includes("not scheduled")) {
    return "That team is on bye or not scheduled this week.";
  }

  if (haystack.includes("ambiguous")) {
    return "Schedule is ambiguous for that team this week. Resolve the schedule first.";
  }

  if (haystack.includes("postponed")) {
    return "Cannot override a postponed game until its status is settled.";
  }

  if (haystack.includes("canceled")) {
    return "Cannot override a canceled game.";
  }

  if (haystack.includes("missing authoritative scores")) {
    return "That final game is missing scores. Sync the schedule first.";
  }

  if (haystack.includes("undefined game status")) {
    return "That game has an undefined status for overrides.";
  }

  if (haystack.includes("no pick to clear")) {
    return "There is no pick to clear for this player and week.";
  }

  if (
    haystack.includes("not an active member") ||
    haystack.includes("inactive")
  ) {
    return "That player is not an active member of this league.";
  }

  if (
    haystack.includes("only an active league commissioner") ||
    haystack.includes("authentication required") ||
    error.code === "42501"
  ) {
    return "You are not authorized to override picks.";
  }

  if (haystack.includes("season is not active")) {
    return "The season must be active before overriding picks.";
  }

  if (haystack.includes("outside the regular season")) {
    return "Only regular-season weeks can be overridden here.";
  }

  if (haystack.includes("network") || haystack.includes("fetch failed")) {
    return "Database unavailable. Check your connection and try again.";
  }

  return "Could not save the override. Please try again.";
}

export function weeklyPointsLabel(result: PickResult | null | undefined): number {
  return result === "win" ? 1 : 0;
}

export function resultLabel(result: PickResult | null | undefined): string {
  if (!result) return "—";
  switch (result) {
    case "pending":
      return "Pending";
    case "win":
      return "Win";
    case "loss":
      return "Loss";
    case "tie":
      return "Tie";
    default:
      return result;
  }
}
