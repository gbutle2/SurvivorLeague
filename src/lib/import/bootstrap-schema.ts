/**
 * Versioned bootstrap import document (workbook-derived JSON).
 * Auth UUIDs and emails must be supplied explicitly — never hardcoded.
 */

export const BOOTSTRAP_IMPORT_VERSION = 1 as const;

export type BootstrapMemberInput = {
  /** Prefer this when known from Supabase Auth. */
  auth_user_id?: string;
  /** Admin script may look up Auth by email when auth_user_id omitted. */
  email?: string;
  display_name: string;
  role: "commissioner" | "player";
  active: boolean;
};

export type BootstrapWeekInput = {
  week_number: number;
  label: string;
  /** YYYY-MM-DD America/Chicago */
  lock_date: string;
  /** HH:mm or HH:mm:ss America/Chicago */
  lock_time: string;
  status: "upcoming" | "open" | "locked" | "final";
};

export type BootstrapPickInput = {
  week_number: number;
  /** Match a members[] entry by auth_user_id or email. */
  auth_user_id?: string;
  email?: string;
  /** NFL team abbreviation (e.g. KC) — resolved against teams table. */
  team_abbreviation: string;
  result: "pending" | "win" | "loss" | "tie";
};

export type BootstrapScoringRulesInput = {
  correct_regular_pick_points: number;
  best_record_bonus: number;
  longest_streak_bonus: number;
  survivor_bonus: number;
  wildcard_points: number;
  divisional_points: number;
  conference_points: number;
  superbowl_points: number;
  perfect_season_override: boolean;
};

export type BootstrapImportDocument = {
  version: typeof BOOTSTRAP_IMPORT_VERSION;
  league: {
    slug: string;
    name: string;
    timezone: string;
  };
  season: {
    year: number;
    status: "setup" | "active" | "complete";
    regular_week_count: number;
  };
  scoring_rules: BootstrapScoringRulesInput;
  members: BootstrapMemberInput[];
  weeks: BootstrapWeekInput[];
  picks: BootstrapPickInput[];
};

export type ValidationResult =
  | { ok: true; document: BootstrapImportDocument }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim();
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean.`);
  }
  return value;
}

function requireInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${field} must be an integer.`);
  }
  return value;
}

const WEEK_STATUSES = new Set(["upcoming", "open", "locked", "final"]);
const PICK_RESULTS = new Set(["pending", "win", "loss", "tie"]);
const ROLES = new Set(["commissioner", "player"]);
const SEASON_STATUSES = new Set(["setup", "active", "complete"]);

/**
 * Validate workbook-derived JSON before any database writes.
 */
export function validateBootstrapDocument(raw: unknown): ValidationResult {
  try {
    if (!isRecord(raw)) {
      return { ok: false, error: "Import root must be a JSON object." };
    }

    if (raw.version !== BOOTSTRAP_IMPORT_VERSION) {
      return {
        ok: false,
        error: `Unsupported import version (expected ${BOOTSTRAP_IMPORT_VERSION}).`,
      };
    }

    if (!isRecord(raw.league)) {
      return { ok: false, error: "league object is required." };
    }
    if (!isRecord(raw.season)) {
      return { ok: false, error: "season object is required." };
    }
    if (!isRecord(raw.scoring_rules)) {
      return { ok: false, error: "scoring_rules object is required." };
    }
    if (!Array.isArray(raw.members) || raw.members.length === 0) {
      return { ok: false, error: "members must be a non-empty array." };
    }
    if (!Array.isArray(raw.weeks)) {
      return { ok: false, error: "weeks must be an array." };
    }
    if (!Array.isArray(raw.picks)) {
      return { ok: false, error: "picks must be an array." };
    }

    const league = {
      slug: requireString(raw.league.slug, "league.slug"),
      name: requireString(raw.league.name, "league.name"),
      timezone: requireString(raw.league.timezone, "league.timezone"),
    };
    if (league.timezone !== "America/Chicago") {
      return {
        ok: false,
        error: 'league.timezone must be "America/Chicago".',
      };
    }

    const seasonStatus = requireString(raw.season.status, "season.status");
    if (!SEASON_STATUSES.has(seasonStatus)) {
      return { ok: false, error: "season.status is invalid." };
    }

    const season = {
      year: requireInt(raw.season.year, "season.year"),
      status: seasonStatus as BootstrapImportDocument["season"]["status"],
      regular_week_count: requireInt(
        raw.season.regular_week_count,
        "season.regular_week_count",
      ),
    };
    if (season.regular_week_count < 1) {
      return { ok: false, error: "season.regular_week_count must be >= 1." };
    }

    const sr = raw.scoring_rules;
    const scoring_rules: BootstrapScoringRulesInput = {
      correct_regular_pick_points: requireInt(
        sr.correct_regular_pick_points,
        "scoring_rules.correct_regular_pick_points",
      ),
      best_record_bonus: requireInt(
        sr.best_record_bonus,
        "scoring_rules.best_record_bonus",
      ),
      longest_streak_bonus: requireInt(
        sr.longest_streak_bonus,
        "scoring_rules.longest_streak_bonus",
      ),
      survivor_bonus: requireInt(
        sr.survivor_bonus,
        "scoring_rules.survivor_bonus",
      ),
      wildcard_points: requireInt(
        sr.wildcard_points,
        "scoring_rules.wildcard_points",
      ),
      divisional_points: requireInt(
        sr.divisional_points,
        "scoring_rules.divisional_points",
      ),
      conference_points: requireInt(
        sr.conference_points,
        "scoring_rules.conference_points",
      ),
      superbowl_points: requireInt(
        sr.superbowl_points,
        "scoring_rules.superbowl_points",
      ),
      perfect_season_override: requireBoolean(
        sr.perfect_season_override,
        "scoring_rules.perfect_season_override",
      ),
    };

    const members: BootstrapMemberInput[] = raw.members.map((row, index) => {
      if (!isRecord(row)) {
        throw new Error(`members[${index}] must be an object.`);
      }
      const auth_user_id =
        typeof row.auth_user_id === "string" && row.auth_user_id.trim()
          ? row.auth_user_id.trim()
          : undefined;
      const email =
        typeof row.email === "string" && row.email.trim()
          ? row.email.trim().toLowerCase()
          : undefined;
      if (!auth_user_id && !email) {
        throw new Error(
          `members[${index}] requires auth_user_id or email.`,
        );
      }
      const role = requireString(row.role, `members[${index}].role`);
      if (!ROLES.has(role)) {
        throw new Error(`members[${index}].role is invalid.`);
      }
      return {
        auth_user_id,
        email,
        display_name: requireString(
          row.display_name,
          `members[${index}].display_name`,
        ),
        role: role as BootstrapMemberInput["role"],
        active: requireBoolean(row.active, `members[${index}].active`),
      };
    });

    const memberKeys = new Set<string>();
    for (const member of members) {
      const key = member.auth_user_id ?? `email:${member.email}`;
      if (memberKeys.has(key)) {
        return { ok: false, error: `Duplicate member identity: ${key}.` };
      }
      memberKeys.add(key);
    }

    const commissionerCount = members.filter(
      (member) => member.role === "commissioner",
    ).length;
    if (commissionerCount !== 1) {
      return {
        ok: false,
        error: "Exactly one commissioner member is required.",
      };
    }

    const weeks: BootstrapWeekInput[] = raw.weeks.map((row, index) => {
      if (!isRecord(row)) {
        throw new Error(`weeks[${index}] must be an object.`);
      }
      const status = requireString(row.status, `weeks[${index}].status`);
      if (!WEEK_STATUSES.has(status)) {
        throw new Error(`weeks[${index}].status is invalid.`);
      }
      return {
        week_number: requireInt(
          row.week_number,
          `weeks[${index}].week_number`,
        ),
        label: requireString(row.label, `weeks[${index}].label`),
        lock_date: requireString(row.lock_date, `weeks[${index}].lock_date`),
        lock_time: requireString(row.lock_time, `weeks[${index}].lock_time`),
        status: status as BootstrapWeekInput["status"],
      };
    });

    if (weeks.length !== season.regular_week_count) {
      return {
        ok: false,
        error: `weeks must include exactly ${season.regular_week_count} entries.`,
      };
    }

    const weekNumbers = new Set<number>();
    for (const week of weeks) {
      if (weekNumbers.has(week.week_number)) {
        return {
          ok: false,
          error: `Duplicate week_number ${week.week_number}.`,
        };
      }
      weekNumbers.add(week.week_number);
    }
    for (let n = 1; n <= season.regular_week_count; n += 1) {
      if (!weekNumbers.has(n)) {
        return {
          ok: false,
          error: `Missing week ${n} in weeks[].`,
        };
      }
    }

    const picks: BootstrapPickInput[] = raw.picks.map((row, index) => {
      if (!isRecord(row)) {
        throw new Error(`picks[${index}] must be an object.`);
      }
      const auth_user_id =
        typeof row.auth_user_id === "string" && row.auth_user_id.trim()
          ? row.auth_user_id.trim()
          : undefined;
      const email =
        typeof row.email === "string" && row.email.trim()
          ? row.email.trim().toLowerCase()
          : undefined;
      if (!auth_user_id && !email) {
        throw new Error(`picks[${index}] requires auth_user_id or email.`);
      }
      const result = requireString(row.result, `picks[${index}].result`);
      if (!PICK_RESULTS.has(result)) {
        throw new Error(`picks[${index}].result is invalid.`);
      }
      return {
        week_number: requireInt(
          row.week_number,
          `picks[${index}].week_number`,
        ),
        auth_user_id,
        email,
        team_abbreviation: requireString(
          row.team_abbreviation,
          `picks[${index}].team_abbreviation`,
        ).toUpperCase(),
        result: result as BootstrapPickInput["result"],
      };
    });

    for (const pick of picks) {
      if (!weekNumbers.has(pick.week_number)) {
        return {
          ok: false,
          error: `Pick references unknown week_number ${pick.week_number}.`,
        };
      }
    }

    return {
      ok: true,
      document: {
        version: BOOTSTRAP_IMPORT_VERSION,
        league,
        season,
        scoring_rules,
        members,
        weeks,
        picks,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Invalid import document.",
    };
  }
}
