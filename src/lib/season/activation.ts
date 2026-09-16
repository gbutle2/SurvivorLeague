import type { SeasonStatus } from "@/lib/database.types";

export type ActivationPreconditions = {
  status: SeasonStatus;
  hasScoringRules: boolean;
  weekCount: number;
};

export function activationBlockedReason(
  input: ActivationPreconditions,
): string | null {
  if (input.status !== "setup") {
    return "Only a season in setup can be activated.";
  }
  if (!input.hasScoringRules) {
    return "Add scoring rules for this season before activating.";
  }
  if (input.weekCount < 1) {
    return "Create at least one week before activating the season.";
  }
  return null;
}

export function interpretSeasonActivationRow(
  row: { id: string; status: SeasonStatus } | null | undefined,
): { ok: true; status: SeasonStatus } | { ok: false; error: string } {
  if (!row) {
    return {
      ok: false,
      error:
        "The season was not activated. It may already be active, or your permissions changed. Refresh and try again.",
    };
  }
  if (row.status !== "active") {
    return {
      ok: false,
      error: "The season was not activated. Refresh and try again.",
    };
  }
  return { ok: true, status: row.status };
}

/** Player pick submissions require an active season. */
export function setupSeasonBlocksPicks(status: SeasonStatus): boolean {
  return status === "setup";
}
