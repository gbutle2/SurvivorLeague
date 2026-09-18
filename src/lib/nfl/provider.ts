/**
 * Fixed nflverse schedules provider.
 * Do not accept arbitrary URLs from request parameters.
 */
export const NFLVERSE_PROVIDER = "nflverse" as const;

export const NFLVERSE_SCHEDULES_CSV_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv";

export const NFLVERSE_TIMESTAMP_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/schedules/timestamp.json";

/** Hobby-plan-safe defaults: reject oversized payloads. */
export const NFLVERSE_FETCH_TIMEOUT_MS = 30_000;
export const NFLVERSE_MAX_BYTES = 8_000_000;

export const NFLVERSE_REQUIRED_COLUMNS = [
  "game_id",
  "season",
  "game_type",
  "week",
  "gameday",
  "gametime",
  "away_team",
  "home_team",
  "away_score",
  "home_score",
] as const;
