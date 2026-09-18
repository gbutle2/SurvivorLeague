import { chicagoWallTimeToUtcIso } from "../time/chicago.ts";
import { NFLVERSE_REQUIRED_COLUMNS } from "./provider.ts";
import { mapProviderTeamAbbreviation } from "./team-map.ts";

export type PlayoffRoundCode =
  | "wildcard"
  | "divisional"
  | "conference"
  | "superbowl";

export type ParsedGameStatus =
  | "scheduled"
  | "in_progress"
  | "final"
  | "postponed"
  | "canceled";

export type ParsedProviderGame = {
  providerGameId: string;
  seasonYear: number;
  seasonType: "regular" | "postseason";
  regularWeekNumber: number | null;
  playoffRound: PlayoffRoundCode | null;
  homeAbbreviation: string;
  awayAbbreviation: string;
  scheduledKickoffAt: string;
  status: ParsedGameStatus;
  homeScore: number | null;
  awayScore: number | null;
  winnerAbbreviation: string | null;
};

export type ParseReject = {
  providerGameId: string | null;
  reason: string;
};

const GAME_TYPES_REGULAR = new Set(["REG"]);
const GAME_TYPES_POST: Record<string, PlayoffRoundCode> = {
  WC: "wildcard",
  DIV: "divisional",
  CON: "conference",
  SB: "superbowl",
};

function parseOptionalInt(raw: string): number | null {
  if (!raw || raw.toUpperCase() === "NA" || raw === "null") return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function deriveStatus(
  homeScore: number | null,
  awayScore: number | null,
  gameday: string,
  gametime: string,
): ParsedGameStatus {
  if (homeScore !== null && awayScore !== null) return "final";
  // Provider does not reliably expose live in-progress; treat incomplete as scheduled.
  void gameday;
  void gametime;
  return "scheduled";
}

function kickoffIso(gameday: string, gametime: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(gameday)) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(gametime.trim());
  const time = match
    ? `${match[1]!.padStart(2, "0")}:${match[2]}`
    : "00:00";
  try {
    return chicagoWallTimeToUtcIso(gameday, time);
  } catch {
    return null;
  }
}

export function validateScheduleHeader(row: Record<string, string>): string | null {
  for (const col of NFLVERSE_REQUIRED_COLUMNS) {
    if (!(col in row)) {
      return `Missing required column: ${col}`;
    }
  }
  return null;
}

export function parseProviderGames(
  rows: Record<string, string>[],
  seasonYear: number,
): { games: ParsedProviderGame[]; rejects: ParseReject[] } {
  const games: ParsedProviderGame[] = [];
  const rejects: ParseReject[] = [];
  const seenIds = new Set<string>();

  if (rows.length === 0) {
    return {
      games,
      rejects: [{ providerGameId: null, reason: "Empty schedule payload" }],
    };
  }

  const headerError = validateScheduleHeader(rows[0]!);
  if (headerError) {
    return {
      games,
      rejects: [{ providerGameId: null, reason: headerError }],
    };
  }

  for (const row of rows) {
    const season = parseOptionalInt(row.season ?? "");
    if (season !== seasonYear) continue;

    const providerGameId = (row.game_id ?? "").trim();
    if (!providerGameId) {
      rejects.push({ providerGameId: null, reason: "Missing game_id" });
      continue;
    }
    if (seenIds.has(providerGameId)) {
      rejects.push({
        providerGameId,
        reason: "Duplicate provider_game_id in payload",
      });
      continue;
    }
    seenIds.add(providerGameId);

    const gameType = (row.game_type ?? "").trim().toUpperCase();
    let seasonType: "regular" | "postseason";
    let regularWeekNumber: number | null = null;
    let playoffRound: PlayoffRoundCode | null = null;

    if (GAME_TYPES_REGULAR.has(gameType)) {
      seasonType = "regular";
      regularWeekNumber = parseOptionalInt(row.week ?? "");
      if (
        regularWeekNumber === null ||
        regularWeekNumber < 1 ||
        regularWeekNumber > 18
      ) {
        rejects.push({
          providerGameId,
          reason: `Invalid regular week: ${row.week ?? ""}`,
        });
        continue;
      }
    } else if (gameType in GAME_TYPES_POST) {
      seasonType = "postseason";
      playoffRound = GAME_TYPES_POST[gameType]!;
    } else if (gameType === "PRE") {
      continue; // ignore preseason
    } else {
      rejects.push({
        providerGameId,
        reason: `Unsupported game_type: ${gameType}`,
      });
      continue;
    }

    const homeRaw = row.home_team ?? "";
    const awayRaw = row.away_team ?? "";
    const homeAbbreviation = mapProviderTeamAbbreviation(homeRaw);
    const awayAbbreviation = mapProviderTeamAbbreviation(awayRaw);
    if (!homeAbbreviation || !awayAbbreviation) {
      rejects.push({
        providerGameId,
        reason: `Unknown team abbreviation (${awayRaw}/${homeRaw})`,
      });
      continue;
    }
    if (homeAbbreviation === awayAbbreviation) {
      rejects.push({
        providerGameId,
        reason: "Home and away team are the same",
      });
      continue;
    }

    const gameday = row.gameday ?? "";
    const gametime = row.gametime ?? "";
    const scheduledKickoffAt = kickoffIso(gameday, gametime);
    if (!scheduledKickoffAt) {
      rejects.push({
        providerGameId,
        reason: `Malformed kickoff timestamp (${gameday} ${gametime})`,
      });
      continue;
    }

    const homeScore = parseOptionalInt(row.home_score ?? "");
    const awayScore = parseOptionalInt(row.away_score ?? "");
    if (
      (homeScore === null) !== (awayScore === null) &&
      (row.home_score || row.away_score)
    ) {
      // One-sided score is malformed unless both empty.
      if (row.home_score !== "" || row.away_score !== "") {
        // allow one empty while other empty already handled; if only one set:
        if ((homeScore === null) !== (awayScore === null)) {
          rejects.push({
            providerGameId,
            reason: "Partial scores are invalid",
          });
          continue;
        }
      }
    }

    const status = deriveStatus(homeScore, awayScore, gameday, gametime);
    let winnerAbbreviation: string | null = null;
    if (status === "final" && homeScore !== null && awayScore !== null) {
      if (homeScore > awayScore) winnerAbbreviation = homeAbbreviation;
      else if (awayScore > homeScore) winnerAbbreviation = awayAbbreviation;
      else winnerAbbreviation = null; // tie
    }

    games.push({
      providerGameId,
      seasonYear,
      seasonType,
      regularWeekNumber,
      playoffRound,
      homeAbbreviation,
      awayAbbreviation,
      scheduledKickoffAt,
      status,
      homeScore,
      awayScore,
      winnerAbbreviation,
    });
  }

  return { games, rejects };
}
