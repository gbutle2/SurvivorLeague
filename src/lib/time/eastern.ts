/** Provider wall-clock timezone for nflverse schedules (Eastern Time). */
export const PROVIDER_TIMEZONE = "America/New_York";

export type WallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getTzParts(date: Date, timeZone: string): WallParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) {
      throw new Error(`Missing datetime part: ${type}`);
    }
    return Number(value);
  };

  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/**
 * Convert an America/New_York wall-clock date + time into a UTC Date.
 * Uses IANA timezone rules (EDT/EST), not fixed offsets.
 */
export function easternWallTimeToUtc(date: string, time: string): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());

  if (!dateMatch || !timeMatch) {
    throw new Error("Enter a valid Eastern Time date and time.");
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? "0");

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    throw new Error("Enter a valid Eastern Time date and time.");
  }

  // Start near EST (UTC-5), then refine against America/New_York.
  let guessMs = Date.UTC(year, month - 1, day, hour + 5, minute, second);

  for (let i = 0; i < 4; i += 1) {
    const parts = getTzParts(new Date(guessMs), PROVIDER_TIMEZONE);
    const asUtcLike = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
    const delta = wanted - asUtcLike;
    if (delta === 0) {
      break;
    }
    guessMs += delta;
  }

  const verified = getTzParts(new Date(guessMs), PROVIDER_TIMEZONE);
  if (
    verified.year !== year ||
    verified.month !== month ||
    verified.day !== day ||
    verified.hour !== hour ||
    verified.minute !== minute ||
    verified.second !== second
  ) {
    throw new Error(
      "That Eastern Time does not exist (for example during the spring DST change).",
    );
  }

  return new Date(guessMs);
}

export function easternWallTimeToUtcIso(date: string, time: string): string {
  return easternWallTimeToUtc(date, time).toISOString();
}
