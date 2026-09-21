import type { PickGameOption } from "@/lib/nfl/schedule-query";

/** Matches DB team_regular_game_is_unlocked. */
export function isGameUnlocked(args: {
  status: string;
  scheduledKickoffAt: string;
  nowMs: number;
}): boolean {
  const kickoffMs = new Date(args.scheduledKickoffAt).getTime();
  if (Number.isNaN(kickoffMs)) return false;
  return (
    (args.status === "scheduled" || args.status === "postponed") &&
    kickoffMs > args.nowMs
  );
}

/**
 * True when the player's existing selected team is past its mutation lock.
 * Uses the option when present; otherwise uses authoritative game metadata.
 * Does NOT treat a missing option as "kickoff passed".
 */
export function isExistingPickLocked(args: {
  selectedTeamId: string | null;
  options: PickGameOption[];
  selectedGame?: { status: string; scheduled_kickoff_at: string } | null;
  nowMs?: number;
}): boolean {
  if (!args.selectedTeamId) return false;
  const nowMs = args.nowMs ?? Date.now();
  const option = args.options.find(
    (row) => row.teamId === args.selectedTeamId,
  );
  if (option) {
    return option.locked;
  }
  if (args.selectedGame) {
    return !isGameUnlocked({
      status: args.selectedGame.status,
      scheduledKickoffAt: args.selectedGame.scheduled_kickoff_at,
      nowMs,
    });
  }
  return false;
}

export type PickEditorMode =
  | "editable"
  | "locked"
  | "no_pick"
  | "unavailable";

export function resolvePickEditorMode(args: {
  hasExistingPick: boolean;
  existingPickLocked: boolean;
  noEligibleGames: boolean;
  scheduleUnavailable?: boolean;
}): PickEditorMode {
  if (args.scheduleUnavailable) return "unavailable";
  if (args.noEligibleGames && !args.hasExistingPick) return "unavailable";
  if (args.hasExistingPick && args.existingPickLocked) return "locked";
  if (args.hasExistingPick) return "editable";
  return "no_pick";
}

/** Default expanded state for the collapsible Your Pick panel. */
export function defaultPickEditorExpanded(mode: PickEditorMode): boolean {
  return mode === "no_pick";
}

export function formatPickDeadlineLine(args: {
  locked: boolean;
  kickoffAt: string | null;
  formatKickoff: (iso: string) => string;
}): string {
  if (!args.kickoffAt) {
    return args.locked
      ? "Locked at kickoff"
      : "Editable until your selected team’s kickoff";
  }
  const when = args.formatKickoff(args.kickoffAt);
  return args.locked
    ? `Locked at kickoff · ${when}`
    : `Editable until ${when}`;
}
