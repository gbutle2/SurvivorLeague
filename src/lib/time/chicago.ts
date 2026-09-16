/** League timezone for Sunday Survivor Picks. */
export const LEAGUE_TIMEZONE = "America/Chicago";

export type ChicagoWallParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getChicagoParts(date: Date): ChicagoWallParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LEAGUE_TIMEZONE,
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
 * Convert a Central Time wall-clock date + time into a UTC Date.
 * Does not use the runtime's local timezone for interpretation.
 */
export function chicagoWallTimeToUtc(
  date: string,
  time: string,
): Date {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  const timeMatch = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());

  if (!dateMatch || !timeMatch) {
    throw new Error("Enter a valid Central Time date and time.");
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
    throw new Error("Enter a valid Central Time date and time.");
  }

  // Start near CST (UTC-6), then refine against America/Chicago wall time.
  let guessMs = Date.UTC(year, month - 1, day, hour + 6, minute, second);

  for (let i = 0; i < 4; i += 1) {
    const parts = getChicagoParts(new Date(guessMs));
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

  const verified = getChicagoParts(new Date(guessMs));
  if (
    verified.year !== year ||
    verified.month !== month ||
    verified.day !== day ||
    verified.hour !== hour ||
    verified.minute !== minute ||
    verified.second !== second
  ) {
    throw new Error(
      "That Central Time does not exist (for example during the spring DST change). Choose another time.",
    );
  }

  return new Date(guessMs);
}

export function chicagoWallTimeToUtcIso(date: string, time: string): string {
  return chicagoWallTimeToUtc(date, time).toISOString();
}

/** Format a UTC instant for display, always labeled in Central Time. */
export function formatCentralDateTime(isoUtc: string | Date): string {
  const date = typeof isoUtc === "string" ? new Date(isoUtc) : isoUtc;
  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: LEAGUE_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

/** Values suitable for datetime-local inputs, expressed in Central Time. */
export function toChicagoDateAndTimeInputs(isoUtc: string | Date): {
  date: string;
  time: string;
} {
  const date = typeof isoUtc === "string" ? new Date(isoUtc) : isoUtc;
  const parts = getChicagoParts(date);
  const pad = (n: number) => String(n).padStart(2, "0");

  return {
    date: `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`,
    time: `${pad(parts.hour)}:${pad(parts.minute)}`,
  };
}

export function isLockedAt(locksAtIso: string, now: Date = new Date()): boolean {
  return new Date(locksAtIso).getTime() <= now.getTime();
}
