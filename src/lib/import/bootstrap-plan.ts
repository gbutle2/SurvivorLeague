import { chicagoWallTimeToUtcIso } from "../time/chicago.ts";
import type {
  BootstrapImportDocument,
  BootstrapMemberInput,
  BootstrapPickInput,
  BootstrapWeekInput,
} from "./bootstrap-schema.ts";

export type ImportCounts = {
  inserted: number;
  updated: number;
  skipped: number;
  conflicts: number;
};

export type PlannedMutation =
  | { entity: "profile"; action: "insert" | "update" | "skip"; key: string }
  | { entity: "membership"; action: "insert" | "update" | "skip"; key: string }
  | { entity: "league"; action: "insert" | "update" | "skip"; key: string }
  | { entity: "season"; action: "insert" | "update" | "skip"; key: string }
  | {
      entity: "scoring_rules";
      action: "insert" | "update" | "skip";
      key: string;
    }
  | { entity: "week"; action: "insert" | "update" | "skip"; key: string }
  | { entity: "pick"; action: "insert" | "update" | "skip"; key: string };

export type ImportConflict = {
  entity: string;
  key: string;
  message: string;
};

export type ExistingBootstrapSnapshot = {
  league:
    | {
        id: string;
        name: string;
        slug: string;
        timezone: string;
        commissioner_user_id: string;
      }
    | null;
  season:
    | {
        id: string;
        year: number;
        status: string;
        regular_week_count: number;
      }
    | null;
  scoring_rules: Record<string, number | boolean> | null;
  profilesById: Map<string, { id: string; display_name: string }>;
  membersByUserId: Map<
    string,
    { user_id: string; role: string; active: boolean }
  >;
  weeksByNumber: Map<
    number,
    {
      week_number: number;
      label: string;
      locks_at: string;
      status: string;
    }
  >;
  /** key: `${week_number}:${user_id}` */
  picksByWeekUser: Map<
    string,
    {
      week_number: number;
      user_id: string;
      team_abbreviation: string;
      result: string;
    }
  >;
  /** Resolved Auth UUID by email (lowercase). Admin script only. */
  authUserIdByEmail: Map<string, string>;
  /** Known team abbreviations (uppercase) → id */
  teamIdByAbbreviation: Map<string, string>;
};

export type BootstrapPlan =
  | {
      ok: true;
      dryRun: boolean;
      counts: ImportCounts;
      mutations: PlannedMutation[];
      conflicts: ImportConflict[];
      resolvedMembers: Array<{
        userId: string;
        display_name: string;
        role: BootstrapMemberInput["role"];
        active: boolean;
      }>;
      preparedWeeks: Array<{
        week_number: number;
        label: string;
        locks_at: string;
        status: BootstrapWeekInput["status"];
      }>;
      preparedPicks: Array<{
        week_number: number;
        user_id: string;
        team_abbreviation: string;
        result: BootstrapPickInput["result"];
      }>;
    }
  | { ok: false; error: string; conflicts: ImportConflict[] };

function emptyCounts(): ImportCounts {
  return { inserted: 0, updated: 0, skipped: 0, conflicts: 0 };
}

function bump(
  counts: ImportCounts,
  action: PlannedMutation["action"],
): void {
  if (action === "insert") counts.inserted += 1;
  else if (action === "update") counts.updated += 1;
  else counts.skipped += 1;
}

function memberIdentity(member: BootstrapMemberInput): string {
  return member.auth_user_id ?? `email:${member.email}`;
}

function resolveMemberUserId(
  member: BootstrapMemberInput,
  existing: ExistingBootstrapSnapshot,
): { ok: true; userId: string } | { ok: false; error: string } {
  if (member.auth_user_id) {
    return { ok: true, userId: member.auth_user_id };
  }
  if (member.email) {
    const found = existing.authUserIdByEmail.get(member.email.toLowerCase());
    if (!found) {
      return {
        ok: false,
        error: `No Auth user found for email ${member.email}. Supply auth_user_id from Supabase Auth.`,
      };
    }
    return { ok: true, userId: found };
  }
  return { ok: false, error: "Member missing auth_user_id and email." };
}

/**
 * Plan bootstrap mutations without writing.
 * When allowOverwrite is false, any conflicting existing row blocks the plan.
 */
export function planBootstrapImport(options: {
  document: BootstrapImportDocument;
  existing: ExistingBootstrapSnapshot;
  dryRun: boolean;
  allowOverwrite: boolean;
}): BootstrapPlan {
  const { document, existing, dryRun, allowOverwrite } = options;
  const counts = emptyCounts();
  const mutations: PlannedMutation[] = [];
  const conflicts: ImportConflict[] = [];

  const resolvedMembers: Array<{
    userId: string;
    display_name: string;
    role: BootstrapMemberInput["role"];
    active: boolean;
  }> = [];

  for (const member of document.members) {
    const resolved = resolveMemberUserId(member, existing);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, conflicts };
    }
    resolvedMembers.push({
      userId: resolved.userId,
      display_name: member.display_name,
      role: member.role,
      active: member.active,
    });

    const profile = existing.profilesById.get(resolved.userId);
    const profileKey = memberIdentity(member);
    if (!profile) {
      mutations.push({
        entity: "profile",
        action: "insert",
        key: profileKey,
      });
      bump(counts, "insert");
    } else if (profile.display_name !== member.display_name) {
      if (!allowOverwrite) {
        conflicts.push({
          entity: "profile",
          key: profileKey,
          message: `Profile ${resolved.userId} display_name differs (not overwritten).`,
        });
      } else {
        mutations.push({
          entity: "profile",
          action: "update",
          key: profileKey,
        });
        bump(counts, "update");
      }
    } else {
      mutations.push({ entity: "profile", action: "skip", key: profileKey });
      bump(counts, "skip");
    }

    const membership = existing.membersByUserId.get(resolved.userId);
    if (!membership) {
      mutations.push({
        entity: "membership",
        action: "insert",
        key: profileKey,
      });
      bump(counts, "insert");
    } else if (
      membership.role !== member.role ||
      membership.active !== member.active
    ) {
      if (!allowOverwrite) {
        conflicts.push({
          entity: "membership",
          key: profileKey,
          message: `Membership for ${resolved.userId} differs (not overwritten).`,
        });
      } else {
        mutations.push({
          entity: "membership",
          action: "update",
          key: profileKey,
        });
        bump(counts, "update");
      }
    } else {
      mutations.push({
        entity: "membership",
        action: "skip",
        key: profileKey,
      });
      bump(counts, "skip");
    }
  }

  const commissioner = resolvedMembers.find(
    (member) => member.role === "commissioner",
  );
  if (!commissioner) {
    return {
      ok: false,
      error: "Exactly one commissioner is required.",
      conflicts,
    };
  }

  if (existing.league) {
    const league = existing.league;
    if (
      league.slug !== document.league.slug ||
      league.name !== document.league.name ||
      league.timezone !== document.league.timezone ||
      league.commissioner_user_id !== commissioner.userId
    ) {
      if (!allowOverwrite) {
        conflicts.push({
          entity: "league",
          key: document.league.slug,
          message: "Existing league differs from import (not overwritten).",
        });
      } else {
        mutations.push({
          entity: "league",
          action: "update",
          key: document.league.slug,
        });
        bump(counts, "update");
      }
    } else {
      mutations.push({
        entity: "league",
        action: "skip",
        key: document.league.slug,
      });
      bump(counts, "skip");
    }
  } else {
    mutations.push({
      entity: "league",
      action: "insert",
      key: document.league.slug,
    });
    bump(counts, "insert");
  }

  if (existing.season) {
    if (
      existing.season.year !== document.season.year ||
      existing.season.status !== document.season.status ||
      existing.season.regular_week_count !== document.season.regular_week_count
    ) {
      if (!allowOverwrite) {
        conflicts.push({
          entity: "season",
          key: String(document.season.year),
          message: "Existing season differs from import (not overwritten).",
        });
      } else {
        mutations.push({
          entity: "season",
          action: "update",
          key: String(document.season.year),
        });
        bump(counts, "update");
      }
    } else {
      mutations.push({
        entity: "season",
        action: "skip",
        key: String(document.season.year),
      });
      bump(counts, "skip");
    }
  } else {
    mutations.push({
      entity: "season",
      action: "insert",
      key: String(document.season.year),
    });
    bump(counts, "insert");
  }

  const scoringEntries = Object.entries(document.scoring_rules);
  if (existing.scoring_rules) {
    const differs = scoringEntries.some(
      ([key, value]) => existing.scoring_rules?.[key] !== value,
    );
    if (differs) {
      if (!allowOverwrite) {
        conflicts.push({
          entity: "scoring_rules",
          key: String(document.season.year),
          message: "Existing scoring_rules differ (not overwritten).",
        });
      } else {
        mutations.push({
          entity: "scoring_rules",
          action: "update",
          key: String(document.season.year),
        });
        bump(counts, "update");
      }
    } else {
      mutations.push({
        entity: "scoring_rules",
        action: "skip",
        key: String(document.season.year),
      });
      bump(counts, "skip");
    }
  } else {
    mutations.push({
      entity: "scoring_rules",
      action: "insert",
      key: String(document.season.year),
    });
    bump(counts, "insert");
  }

  const preparedWeeks: Array<{
    week_number: number;
    label: string;
    locks_at: string;
    status: BootstrapWeekInput["status"];
  }> = [];

  for (const week of document.weeks) {
    let locksAt: string;
    try {
      locksAt = chicagoWallTimeToUtcIso(week.lock_date, week.lock_time);
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof Error
            ? `Week ${week.week_number}: ${error.message}`
            : `Week ${week.week_number}: invalid Central Time deadline.`,
        conflicts,
      };
    }

    preparedWeeks.push({
      week_number: week.week_number,
      label: week.label,
      locks_at: locksAt,
      status: week.status,
    });

    const prior = existing.weeksByNumber.get(week.week_number);
    const key = `week:${week.week_number}`;
    if (!prior) {
      mutations.push({ entity: "week", action: "insert", key });
      bump(counts, "insert");
    } else {
      const same =
        prior.label === week.label &&
        prior.status === week.status &&
        new Date(prior.locks_at).getTime() === new Date(locksAt).getTime();
      if (!same) {
        if (!allowOverwrite) {
          conflicts.push({
            entity: "week",
            key,
            message: `Week ${week.week_number} already exists and differs (not overwritten).`,
          });
        } else {
          mutations.push({ entity: "week", action: "update", key });
          bump(counts, "update");
        }
      } else {
        mutations.push({ entity: "week", action: "skip", key });
        bump(counts, "skip");
      }
    }
  }

  const preparedPicks: Array<{
    week_number: number;
    user_id: string;
    team_abbreviation: string;
    result: BootstrapPickInput["result"];
  }> = [];

  const memberByEmail = new Map(
    document.members
      .filter((member) => member.email)
      .map((member) => [member.email!.toLowerCase(), member]),
  );
  const memberByAuth = new Map(
    document.members
      .filter((member) => member.auth_user_id)
      .map((member) => [member.auth_user_id!, member]),
  );

  for (const pick of document.picks) {
    let userId: string | undefined;
    if (pick.auth_user_id) {
      userId = pick.auth_user_id;
      if (!memberByAuth.has(pick.auth_user_id)) {
        const resolved = resolvedMembers.find(
          (member) => member.userId === pick.auth_user_id,
        );
        if (!resolved) {
          return {
            ok: false,
            error: `Pick for week ${pick.week_number} references unknown auth_user_id.`,
            conflicts,
          };
        }
      }
    } else if (pick.email) {
      const member = memberByEmail.get(pick.email.toLowerCase());
      if (!member) {
        return {
          ok: false,
          error: `Pick for week ${pick.week_number} email ${pick.email} is not in members[].`,
          conflicts,
        };
      }
      const resolved = resolveMemberUserId(member, existing);
      if (!resolved.ok) {
        return { ok: false, error: resolved.error, conflicts };
      }
      userId = resolved.userId;
    }

    if (!userId) {
      return {
        ok: false,
        error: `Pick for week ${pick.week_number} could not resolve a user.`,
        conflicts,
      };
    }

    if (!existing.teamIdByAbbreviation.has(pick.team_abbreviation)) {
      return {
        ok: false,
        error: `Unknown team abbreviation ${pick.team_abbreviation}.`,
        conflicts,
      };
    }

    preparedPicks.push({
      week_number: pick.week_number,
      user_id: userId,
      team_abbreviation: pick.team_abbreviation,
      result: pick.result,
    });

    const pickKey = `${pick.week_number}:${userId}`;
    const prior = existing.picksByWeekUser.get(pickKey);
    if (!prior) {
      mutations.push({ entity: "pick", action: "insert", key: pickKey });
      bump(counts, "insert");
    } else if (
      prior.team_abbreviation !== pick.team_abbreviation ||
      prior.result !== pick.result
    ) {
      if (!allowOverwrite) {
        conflicts.push({
          entity: "pick",
          key: pickKey,
          message: `Pick week ${pick.week_number} for user ${userId} differs (not overwritten).`,
        });
      } else {
        mutations.push({ entity: "pick", action: "update", key: pickKey });
        bump(counts, "update");
      }
    } else {
      mutations.push({ entity: "pick", action: "skip", key: pickKey });
      bump(counts, "skip");
    }
  }

  counts.conflicts = conflicts.length;

  if (conflicts.length > 0 && !allowOverwrite) {
    return {
      ok: false,
      error:
        "Conflicting production data detected. Re-run with --allow-overwrite only after review.",
      conflicts,
    };
  }

  return {
    ok: true,
    dryRun,
    counts,
    mutations,
    conflicts,
    resolvedMembers,
    preparedWeeks,
    preparedPicks,
  };
}

/** Pure dry-run helper used by tests — never performs writes. */
export function dryRunBootstrapImport(options: {
  document: BootstrapImportDocument;
  existing: ExistingBootstrapSnapshot;
  allowOverwrite?: boolean;
}): BootstrapPlan {
  return planBootstrapImport({
    document: options.document,
    existing: options.existing,
    dryRun: true,
    allowOverwrite: options.allowOverwrite ?? false,
  });
}

export function emptyExistingSnapshot(): ExistingBootstrapSnapshot {
  return {
    league: null,
    season: null,
    scoring_rules: null,
    profilesById: new Map(),
    membersByUserId: new Map(),
    weeksByNumber: new Map(),
    picksByWeekUser: new Map(),
    authUserIdByEmail: new Map(),
    teamIdByAbbreviation: new Map([
      ["KC", "team-kc"],
      ["BUF", "team-buf"],
      ["PHI", "team-phi"],
      ["SF", "team-sf"],
      ["BAL", "team-bal"],
      ["DET", "team-det"],
    ]),
  };
}
