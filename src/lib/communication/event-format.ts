import type { Json } from "@/lib/database.types";
import type {
  LeagueEventForFormat,
  LeagueEventType,
  TeamLookup,
} from "@/lib/communication/types";

function asRecord(payload: Json): Record<string, unknown> {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return payload as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function displayName(
  primary: string | null | undefined,
  fallback = "Member",
): string {
  const trimmed = primary?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`;
}

/**
 * Resolve a team nickname. Keys may be team id or abbreviation.
 * Never invents a nickname from a raw id when missing from the map.
 */
function teamNickname(
  teamKey: string | null | undefined,
  teams: TeamLookup | undefined,
): string {
  if (!teamKey) return "team";
  const nick = teams?.get(teamKey);
  return nick && nick.trim() ? nick.trim() : "team";
}

function weekLabel(payload: Record<string, unknown>): string {
  const n = asNumber(payload.week_number);
  return n != null ? `Week ${n}` : "this week";
}

function formatPickSubmitted(
  event: LeagueEventForFormat,
  teams: TeamLookup | undefined,
  payload: Record<string, unknown>,
): string {
  const member = displayName(
    event.affected_display_name ?? event.actor_display_name,
  );
  const week = weekLabel(payload);
  if (!event.is_revealed) {
    return `${member} submitted a pick for ${week}.`;
  }
  const team = teamNickname(asString(payload.team_id), teams);
  return `${member} picked the ${team} for ${week}.`;
}

function formatPickUpdated(
  event: LeagueEventForFormat,
  teams: TeamLookup | undefined,
  payload: Record<string, unknown>,
): string {
  const member = displayName(
    event.affected_display_name ?? event.actor_display_name,
  );
  const week = weekLabel(payload);
  if (!event.is_revealed) {
    return `${member} updated their pick for ${week}.`;
  }
  const team = teamNickname(asString(payload.team_id), teams);
  return `${member} picked the ${team} for ${week}.`;
}

function formatCommissionerPickChanged(
  event: LeagueEventForFormat,
  teams: TeamLookup | undefined,
  payload: Record<string, unknown>,
): string {
  const member = displayName(event.affected_display_name);
  const week = weekLabel(payload);
  if (!event.is_revealed) {
    return `Commissioner updated ${possessive(member)} pick for ${week}.`;
  }
  const team = teamNickname(asString(payload.team_id), teams);
  const previous = asString(payload.previous_team_id);
  if (previous) {
    const oldTeam = teamNickname(previous, teams);
    return `Commissioner changed ${possessive(member)} ${week} pick from the ${oldTeam} to the ${team}.`;
  }
  return `Commissioner set ${possessive(member)} ${week} pick to the ${team}.`;
}

function formatResult(
  event: LeagueEventForFormat,
  payload: Record<string, unknown>,
  corrected: boolean,
): string {
  const member = displayName(event.affected_display_name);
  const week = weekLabel(payload);
  const result = asString(payload.result) ?? "result";
  if (corrected) {
    return `${possessive(member)} ${week} result was corrected to ${result}.`;
  }
  return `${member} got a ${result} in ${week}.`;
}

const FORMATTERS: Record<
  LeagueEventType,
  (
    event: LeagueEventForFormat,
    teams: TeamLookup | undefined,
    payload: Record<string, unknown>,
  ) => string
> = {
  pick_submitted: formatPickSubmitted,
  pick_updated: formatPickUpdated,
  commissioner_pick_changed: formatCommissionerPickChanged,
  week_opened: (_e, _t, payload) =>
    `${weekLabel(payload)} is now open for picks.`,
  week_locked: (_e, _t, payload) => `${weekLabel(payload)} picks are locked.`,
  picks_revealed: (_e, _t, payload) =>
    `${weekLabel(payload)} picks have been revealed.`,
  result_entered: (event, _t, payload) => formatResult(event, payload, false),
  result_corrected: (event, _t, payload) => formatResult(event, payload, true),
  survivor_eliminated: (event) =>
    `${displayName(event.affected_display_name)} was eliminated from Survivor.`,
  season_activated: (_e, _t, payload) => {
    const year = asNumber(payload.year);
    return year != null
      ? `The ${year} season is now active.`
      : "The season is now active.";
  },
  season_deactivated: (_e, _t, payload) => {
    const year = asNumber(payload.year);
    return year != null
      ? `The ${year} season is no longer active.`
      : "The season is no longer active.";
  },
  member_added: (event) =>
    `${displayName(event.affected_display_name)} joined the league.`,
  member_removed: (event) =>
    `${displayName(event.affected_display_name)} left the league.`,
  commissioner_announcement: (_e, _t, payload) => {
    const message =
      asString(payload.message) ??
      asString(payload.body) ??
      asString(payload.title);
    return message ?? "Commissioner announcement.";
  },
};

/**
 * Privacy-safe league event formatter.
 * When `!is_revealed`, never includes team names or ids in the output string.
 */
export function formatLeagueEvent(
  event: LeagueEventForFormat,
  teams?: TeamLookup,
): string {
  const payload = asRecord(event.payload);
  // Defense in depth: strip team keys from the view used when unrevealed.
  const safePayload = event.is_revealed
    ? payload
    : Object.fromEntries(
        Object.entries(payload).filter(
          ([key]) =>
            key !== "team_id" &&
            key !== "previous_team_id" &&
            key !== "team_abbreviation" &&
            key !== "previous_team_abbreviation" &&
            key !== "team_name" &&
            key !== "previous_team_name",
        ),
      );
  const formatter = FORMATTERS[event.event_type];
  if (!formatter) {
    return "League activity.";
  }
  return formatter(event, event.is_revealed ? teams : undefined, safePayload);
}
