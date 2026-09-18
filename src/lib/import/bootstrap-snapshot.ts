import type pg from "pg";

import type { BootstrapImportDocument } from "./bootstrap-schema.ts";
import type { ExistingBootstrapSnapshot } from "./bootstrap-plan.ts";
import { queryMaybeOne, queryRows } from "./pg-query.ts";

type Queryable = Pick<pg.Client, "query">;

export type ResolvedAuthMember = {
  userId: string;
  display_name: string;
  role: "commissioner" | "player";
  active: boolean;
};

/**
 * Resolve every intended Auth user first (by UUID and/or email).
 * Fail closed on query errors; treat missing Auth rows as validation errors.
 */
export async function resolveAuthMembers(
  client: Queryable,
  document: BootstrapImportDocument,
): Promise<ResolvedAuthMember[]> {
  const wantedIds = [
    ...new Set(
      document.members
        .map((member) => member.auth_user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const wantedEmails = [
    ...new Set(
      document.members
        .map((member) => member.email?.toLowerCase())
        .filter((email): email is string => Boolean(email)),
    ),
  ];

  const existingById = new Map<string, string>();
  if (wantedIds.length > 0) {
    const rows = await queryRows<{ id: string }>(
      client,
      `SELECT id::text AS id FROM auth.users WHERE id = ANY($1::uuid[])`,
      [wantedIds],
    );
    for (const row of rows) {
      existingById.set(row.id, row.id);
    }
  }

  const idByEmail = new Map<string, string>();
  if (wantedEmails.length > 0) {
    const rows = await queryRows<{ id: string; email: string }>(
      client,
      `SELECT id::text AS id, lower(email) AS email
       FROM auth.users
       WHERE lower(email) = ANY($1::text[])`,
      [wantedEmails],
    );
    for (const row of rows) {
      idByEmail.set(row.email, row.id);
    }
  }

  const resolved: ResolvedAuthMember[] = [];
  for (const member of document.members) {
    let userId: string | undefined;
    if (member.auth_user_id) {
      if (!existingById.has(member.auth_user_id)) {
        throw new Error(
          `Auth user ${member.auth_user_id} (${member.display_name}) does not exist.`,
        );
      }
      userId = member.auth_user_id;
    } else if (member.email) {
      const found = idByEmail.get(member.email.toLowerCase());
      if (!found) {
        throw new Error(
          `No Auth user found for member display_name="${member.display_name}". Supply auth_user_id from Supabase Auth.`,
        );
      }
      userId = found;
    } else {
      throw new Error(
        `Member "${member.display_name}" requires auth_user_id or email.`,
      );
    }
    resolved.push({
      userId,
      display_name: member.display_name,
      role: member.role,
      active: member.active,
    });
  }

  return resolved;
}

/**
 * Load bootstrap snapshot inside the caller's transaction.
 * Profiles are loaded for every resolved member UUID, not only current members.
 */
export async function loadBootstrapSnapshot(
  client: Queryable,
  document: BootstrapImportDocument,
  resolvedMembers: ResolvedAuthMember[],
): Promise<ExistingBootstrapSnapshot> {
  const snapshot: ExistingBootstrapSnapshot = {
    league: null,
    season: null,
    scoring_rules: null,
    profilesById: new Map(),
    membersByUserId: new Map(),
    weeksByNumber: new Map(),
    picksByWeekUser: new Map(),
    authUserIdByEmail: new Map(),
    teamIdByAbbreviation: new Map(),
  };

  for (const member of resolvedMembers) {
    // Preserve email map only for planner resolve paths that still key by email.
    const source = document.members.find(
      (row) =>
        row.auth_user_id === member.userId ||
        (row.display_name === member.display_name && row.role === member.role),
    );
    if (source?.email) {
      snapshot.authUserIdByEmail.set(source.email.toLowerCase(), member.userId);
    }
  }

  const teams = await queryRows<{ id: string; abbreviation: string }>(
    client,
    `SELECT id::text AS id, upper(abbreviation) AS abbreviation FROM public.teams`,
  );
  if (teams.length === 0) {
    throw new Error(
      "Teams reference table is empty; cannot validate pick abbreviations.",
    );
  }
  for (const team of teams) {
    snapshot.teamIdByAbbreviation.set(team.abbreviation, team.id);
  }

  const memberIds = resolvedMembers.map((member) => member.userId);
  if (memberIds.length > 0) {
    const profiles = await queryRows<{ id: string; display_name: string }>(
      client,
      `SELECT id::text AS id, display_name
       FROM public.profiles
       WHERE id = ANY($1::uuid[])`,
      [memberIds],
    );
    for (const profile of profiles) {
      snapshot.profilesById.set(profile.id, profile);
    }
  }

  const league = await queryMaybeOne<{
    id: string;
    name: string;
    slug: string;
    timezone: string;
    commissioner_user_id: string;
  }>(
    client,
    `SELECT id::text AS id, name, slug, timezone,
            commissioner_user_id::text AS commissioner_user_id
     FROM public.leagues
     WHERE slug = $1`,
    [document.league.slug],
  );

  if (!league) {
    return snapshot;
  }
  snapshot.league = league;

  const members = await queryRows<{
    user_id: string;
    role: string;
    active: boolean;
  }>(
    client,
    `SELECT user_id::text AS user_id, role::text AS role, active
     FROM public.league_members
     WHERE league_id = $1::uuid`,
    [league.id],
  );
  for (const member of members) {
    snapshot.membersByUserId.set(member.user_id, member);
  }

  const season = await queryMaybeOne<{
    id: string;
    year: number;
    status: string;
    regular_week_count: number;
  }>(
    client,
    `SELECT id::text AS id, year, status::text AS status, regular_week_count
     FROM public.seasons
     WHERE league_id = $1::uuid AND year = $2`,
    [league.id, document.season.year],
  );

  if (!season) {
    return snapshot;
  }
  snapshot.season = season;

  const rules = await queryMaybeOne<Record<string, number | boolean>>(
    client,
    `SELECT correct_regular_pick_points, best_record_bonus, longest_streak_bonus,
            survivor_bonus, wildcard_points, divisional_points, conference_points,
            superbowl_points, perfect_season_override
     FROM public.scoring_rules
     WHERE season_id = $1::uuid`,
    [season.id],
  );
  snapshot.scoring_rules = rules;

  const weeks = await queryRows<{
    id: string;
    week_number: number;
    label: string;
    locks_at: string;
    status: string;
  }>(
    client,
    `SELECT id::text AS id, week_number, label,
            locks_at::text AS locks_at, status::text AS status
     FROM public.weeks
     WHERE season_id = $1::uuid
     ORDER BY week_number`,
    [season.id],
  );

  const weekIdToNumber = new Map<string, number>();
  for (const week of weeks) {
    snapshot.weeksByNumber.set(week.week_number, week);
    weekIdToNumber.set(week.id, week.week_number);
  }

  const weekIds = [...weekIdToNumber.keys()];
  if (weekIds.length === 0) {
    return snapshot;
  }

  const picks = await queryRows<{
    week_id: string;
    user_id: string;
    team_id: string;
    result: string;
  }>(
    client,
    `SELECT week_id::text AS week_id, user_id::text AS user_id,
            team_id::text AS team_id, result::text AS result
     FROM public.picks
     WHERE week_id = ANY($1::uuid[])`,
    [weekIds],
  );

  const teamById = new Map(
    [...snapshot.teamIdByAbbreviation.entries()].map(([abbr, id]) => [
      id,
      abbr,
    ]),
  );

  for (const pick of picks) {
    const weekNumber = weekIdToNumber.get(pick.week_id);
    if (weekNumber == null) {
      throw new Error(
        `Pick references week_id ${pick.week_id} outside loaded season weeks.`,
      );
    }
    const abbr = teamById.get(pick.team_id);
    if (!abbr) {
      throw new Error(
        `Pick team_id ${pick.team_id} is not a known teams.abbreviation mapping.`,
      );
    }
    snapshot.picksByWeekUser.set(`${weekNumber}:${pick.user_id}`, {
      week_number: weekNumber,
      user_id: pick.user_id,
      team_abbreviation: abbr,
      result: pick.result,
    });
  }

  return snapshot;
}
