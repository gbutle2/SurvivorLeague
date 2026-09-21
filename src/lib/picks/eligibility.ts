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

export type ExistingPickLockState = "editable" | "locked" | "unavailable";

export type AuthoritativePickGame = {
  id: string;
  status: string;
  scheduled_kickoff_at: string;
  home_team_id: string;
  away_team_id: string;
};

/**
 * Resolve the saved pick’s authoritative game by game_id when present.
 * Falls back to team+week match only for legacy null game_id rows.
 * Never uses used-team or search-filtered option lists.
 */
export function resolveAuthoritativePickGame(args: {
  pick: { team_id: string; game_id: string | null } | null;
  games: readonly AuthoritativePickGame[];
}): {
  game: AuthoritativePickGame | null;
  unresolved: boolean;
} {
  if (!args.pick) {
    return { game: null, unresolved: false };
  }

  if (args.pick.game_id) {
    const byId =
      args.games.find((game) => game.id === args.pick!.game_id) ?? null;
    if (byId) {
      return { game: byId, unresolved: false };
    }
    return { game: null, unresolved: true };
  }

  const byTeam =
    args.games.find(
      (game) =>
        game.home_team_id === args.pick!.team_id ||
        game.away_team_id === args.pick!.team_id,
    ) ?? null;
  if (byTeam) {
    return { game: byTeam, unresolved: false };
  }
  return { game: null, unresolved: true };
}

/**
 * Tri-state lock for an existing saved pick.
 * Missing/unresolved schedule data ⇒ unavailable (not editable, not locked).
 */
export function resolveExistingPickLockState(args: {
  hasExistingPick: boolean;
  weekStatus: string | null | undefined;
  authoritativeGame: AuthoritativePickGame | null;
  gameUnresolved: boolean;
  nowMs: number;
}): ExistingPickLockState {
  if (!args.hasExistingPick) {
    return "editable";
  }

  if (args.weekStatus === "locked" || args.weekStatus === "final") {
    return "locked";
  }

  if (args.gameUnresolved || !args.authoritativeGame) {
    return "unavailable";
  }

  if (
    isGameUnlocked({
      status: args.authoritativeGame.status,
      scheduledKickoffAt: args.authoritativeGame.scheduled_kickoff_at,
      nowMs: args.nowMs,
    })
  ) {
    return "editable";
  }

  return "locked";
}

/**
 * @deprecated Prefer resolveExistingPickLockState. Kept for transitional callers.
 * Maps editable→false, locked→true, unavailable→true (treat as non-editable).
 */
export function isExistingPickLocked(args: {
  selectedTeamId: string | null;
  options?: PickGameOption[];
  selectedGame?: { status: string; scheduled_kickoff_at: string } | null;
  weekStatus?: string | null;
  gameUnresolved?: boolean;
  nowMs?: number;
}): boolean {
  if (!args.selectedTeamId) return false;
  const nowMs = args.nowMs ?? Date.now();
  const state = resolveExistingPickLockState({
    hasExistingPick: true,
    weekStatus: args.weekStatus,
    authoritativeGame: args.selectedGame
      ? {
          id: "unknown",
          status: args.selectedGame.status,
          scheduled_kickoff_at: args.selectedGame.scheduled_kickoff_at,
          home_team_id: "",
          away_team_id: "",
        }
      : null,
    gameUnresolved: args.gameUnresolved ?? !args.selectedGame,
    nowMs,
  });
  return state !== "editable";
}

export type PickEditorMode =
  | "editable"
  | "locked"
  | "no_pick"
  | "unavailable"
  | "unverified";

export function resolvePickEditorMode(args: {
  hasExistingPick: boolean;
  existingPickState: ExistingPickLockState;
  noEligibleGames: boolean;
  scheduleUnavailable?: boolean;
}): PickEditorMode {
  if (args.scheduleUnavailable) return "unavailable";
  if (args.hasExistingPick) {
    if (args.existingPickState === "locked") return "locked";
    if (args.existingPickState === "unavailable") return "unverified";
    return "editable";
  }
  if (args.noEligibleGames) return "unavailable";
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

export const PICK_UNVERIFIED_MESSAGE =
  "Your saved pick could not be verified against the current schedule. Refresh and try again.";
