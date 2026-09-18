/**
 * Map nflverse / historical abbreviations onto seeded teams.abbreviation values.
 */
const ALIASES: Record<string, string> = {
  LA: "LAR",
  LAR: "LAR",
  WSH: "WAS",
  WAS: "WAS",
  OAK: "LV",
  SD: "LAC",
  STL: "LAR",
};

export function mapProviderTeamAbbreviation(
  raw: string,
): string | null {
  const key = raw.trim().toUpperCase();
  if (!key) return null;
  return ALIASES[key] ?? key;
}
