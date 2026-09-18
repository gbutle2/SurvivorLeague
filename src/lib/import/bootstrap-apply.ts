import pg from "pg";

import {
  formatPlanReport,
  planBootstrapImport,
  type BootstrapPlan,
  type ImportCounts,
  type PlannedMutation,
} from "./bootstrap-plan.ts";
import type { BootstrapImportDocument } from "./bootstrap-schema.ts";
import {
  assertTestHookOrThrow,
  isLocalDatabaseUrl,
  readBootstrapTestFailAfter,
  type BootstrapTestFailAfter,
} from "./bootstrap-test-hooks.ts";
import {
  loadBootstrapSnapshot,
  resolveAuthMembers,
} from "./bootstrap-snapshot.ts";
import {
  executeSql,
  queryExactlyOne,
  queryMaybeOne,
  queryRows,
} from "./pg-query.ts";

export type BootstrapApplyResult =
  | {
      ok: true;
      committed: true;
      rolledBack: false;
      dryRun: false;
      counts: ImportCounts;
      plan: Extract<BootstrapPlan, { ok: true }>;
      report: string;
    }
  | {
      ok: true;
      committed: false;
      rolledBack: true;
      dryRun: true;
      counts: ImportCounts;
      plan: Extract<BootstrapPlan, { ok: true }>;
      report: string;
    }
  | {
      ok: false;
      committed: false;
      rolledBack: boolean;
      error: string;
      conflicts?: import("./bootstrap-plan.ts").ImportConflict[];
    };

function advisoryLockKey(slug: string, year: number): string {
  return `bootstrap-import/${slug}/${year}`;
}

function actionFor(
  mutations: PlannedMutation[],
  entity: PlannedMutation["entity"],
  key: string,
): PlannedMutation["action"] | null {
  const match = mutations.find(
    (mutation) => mutation.entity === entity && mutation.key === key,
  );
  return match?.action ?? null;
}

async function acquireBootstrapLock(
  client: pg.Client,
  document: BootstrapImportDocument,
): Promise<void> {
  await queryExactlyOne(
    client,
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0)) AS locked`,
    [advisoryLockKey(document.league.slug, document.season.year)],
  );
}

async function executeWrites(
  client: pg.Client,
  document: BootstrapImportDocument,
  plan: Extract<BootstrapPlan, { ok: true }>,
  failAfter: BootstrapTestFailAfter | null,
): Promise<void> {
  const commissioner = plan.resolvedMembers.find(
    (member) => member.role === "commissioner",
  );
  if (!commissioner) {
    throw new Error("Exactly one commissioner is required.");
  }

  for (const member of plan.resolvedMembers) {
    const action = actionFor(plan.mutations, "profile", member.userId);
    if (action === "insert") {
      await executeSql(
        client,
        `INSERT INTO public.profiles (id, display_name) VALUES ($1::uuid, $2)`,
        [member.userId, member.display_name],
      );
    } else if (action === "update") {
      await executeSql(
        client,
        `UPDATE public.profiles SET display_name = $2 WHERE id = $1::uuid`,
        [member.userId, member.display_name],
      );
    } else if (action !== "skip") {
      throw new Error(`Missing profile plan action for ${member.userId}.`);
    }
  }

  if (failAfter === "profiles") {
    assertTestHookOrThrow("profiles");
  }

  let leagueId: string;
  const leagueAction = actionFor(
    plan.mutations,
    "league",
    document.league.slug,
  );
  if (leagueAction === "insert") {
    const inserted = await queryExactlyOne<{ id: string }>(
      client,
      `INSERT INTO public.leagues (name, slug, timezone, commissioner_user_id)
       VALUES ($1, $2, $3, $4::uuid)
       RETURNING id::text AS id`,
      [
        document.league.name,
        document.league.slug,
        document.league.timezone,
        commissioner.userId,
      ],
    );
    leagueId = inserted.id;
  } else {
    const existingLeague = await queryExactlyOne<{ id: string }>(
      client,
      `SELECT id::text AS id FROM public.leagues WHERE slug = $1`,
      [document.league.slug],
    );
    leagueId = existingLeague.id;
    if (leagueAction === "update") {
      await executeSql(
        client,
        `UPDATE public.leagues
         SET name = $2, timezone = $3, commissioner_user_id = $4::uuid
         WHERE id = $1::uuid`,
        [
          leagueId,
          document.league.name,
          document.league.timezone,
          commissioner.userId,
        ],
      );
    } else if (leagueAction !== "skip") {
      throw new Error("Missing league plan action.");
    }
  }

  for (const member of plan.resolvedMembers) {
    const action = actionFor(plan.mutations, "membership", member.userId);
    if (action === "insert") {
      await executeSql(
        client,
        `INSERT INTO public.league_members (league_id, user_id, role, active)
         VALUES ($1::uuid, $2::uuid, $3::public.member_role, $4)`,
        [leagueId, member.userId, member.role, member.active],
      );
    } else if (action === "update") {
      await executeSql(
        client,
        `UPDATE public.league_members
         SET role = $3::public.member_role, active = $4
         WHERE league_id = $1::uuid AND user_id = $2::uuid`,
        [leagueId, member.userId, member.role, member.active],
      );
    } else if (action !== "skip") {
      throw new Error(`Missing membership plan action for ${member.userId}.`);
    }
  }

  if (failAfter === "memberships") {
    assertTestHookOrThrow("memberships");
  }

  let seasonId: string;
  const seasonKey = String(document.season.year);
  const seasonAction = actionFor(plan.mutations, "season", seasonKey);
  if (seasonAction === "insert") {
    const inserted = await queryExactlyOne<{ id: string }>(
      client,
      `INSERT INTO public.seasons (league_id, year, status, regular_week_count)
       VALUES ($1::uuid, $2, $3::public.season_status, $4)
       RETURNING id::text AS id`,
      [
        leagueId,
        document.season.year,
        document.season.status,
        document.season.regular_week_count,
      ],
    );
    seasonId = inserted.id;
  } else {
    const existingSeason = await queryExactlyOne<{ id: string }>(
      client,
      `SELECT id::text AS id FROM public.seasons
       WHERE league_id = $1::uuid AND year = $2`,
      [leagueId, document.season.year],
    );
    seasonId = existingSeason.id;
    if (seasonAction === "update") {
      await executeSql(
        client,
        `UPDATE public.seasons
         SET status = $2::public.season_status, regular_week_count = $3
         WHERE id = $1::uuid`,
        [seasonId, document.season.status, document.season.regular_week_count],
      );
    } else if (seasonAction !== "skip") {
      throw new Error("Missing season plan action.");
    }
  }

  const rulesAction = actionFor(plan.mutations, "scoring_rules", seasonKey);
  if (rulesAction === "insert") {
    await executeSql(
      client,
      `INSERT INTO public.scoring_rules (
         season_id, correct_regular_pick_points, best_record_bonus,
         longest_streak_bonus, survivor_bonus, wildcard_points,
         divisional_points, conference_points, superbowl_points,
         perfect_season_override
       ) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        seasonId,
        document.scoring_rules.correct_regular_pick_points,
        document.scoring_rules.best_record_bonus,
        document.scoring_rules.longest_streak_bonus,
        document.scoring_rules.survivor_bonus,
        document.scoring_rules.wildcard_points,
        document.scoring_rules.divisional_points,
        document.scoring_rules.conference_points,
        document.scoring_rules.superbowl_points,
        document.scoring_rules.perfect_season_override,
      ],
    );
  } else if (rulesAction === "update") {
    await executeSql(
      client,
      `UPDATE public.scoring_rules SET
         correct_regular_pick_points = $2,
         best_record_bonus = $3,
         longest_streak_bonus = $4,
         survivor_bonus = $5,
         wildcard_points = $6,
         divisional_points = $7,
         conference_points = $8,
         superbowl_points = $9,
         perfect_season_override = $10
       WHERE season_id = $1::uuid`,
      [
        seasonId,
        document.scoring_rules.correct_regular_pick_points,
        document.scoring_rules.best_record_bonus,
        document.scoring_rules.longest_streak_bonus,
        document.scoring_rules.survivor_bonus,
        document.scoring_rules.wildcard_points,
        document.scoring_rules.divisional_points,
        document.scoring_rules.conference_points,
        document.scoring_rules.superbowl_points,
        document.scoring_rules.perfect_season_override,
      ],
    );
  } else if (rulesAction !== "skip") {
    throw new Error("Missing scoring_rules plan action.");
  }

  const weekIdByNumber = new Map<number, string>();
  for (const week of plan.preparedWeeks) {
    const key = `week:${week.week_number}`;
    const action = actionFor(plan.mutations, "week", key);
    if (action === "insert") {
      const inserted = await queryExactlyOne<{ id: string }>(
        client,
        `INSERT INTO public.weeks (season_id, week_number, label, locks_at, status)
         VALUES ($1::uuid, $2, $3, $4::timestamptz, $5::public.week_status)
         RETURNING id::text AS id`,
        [seasonId, week.week_number, week.label, week.locks_at, week.status],
      );
      weekIdByNumber.set(week.week_number, inserted.id);
    } else {
      const existing = await queryExactlyOne<{ id: string }>(
        client,
        `SELECT id::text AS id FROM public.weeks
         WHERE season_id = $1::uuid AND week_number = $2`,
        [seasonId, week.week_number],
      );
      weekIdByNumber.set(week.week_number, existing.id);
      if (action === "update") {
        await executeSql(
          client,
          `UPDATE public.weeks
           SET label = $2, locks_at = $3::timestamptz, status = $4::public.week_status
           WHERE id = $1::uuid`,
          [existing.id, week.label, week.locks_at, week.status],
        );
      } else if (action !== "skip") {
        throw new Error(`Missing week plan action for ${key}.`);
      }
    }

    if (failAfter === "weeks" && week.week_number === 3) {
      assertTestHookOrThrow("weeks");
    }
  }

  for (const pick of plan.preparedPicks) {
    const pickKey = `${pick.week_number}:${pick.user_id}`;
    const action = actionFor(plan.mutations, "pick", pickKey);
    const weekId = weekIdByNumber.get(pick.week_number);
    if (!weekId) {
      throw new Error(`Missing week id for week ${pick.week_number}.`);
    }
    const team = await queryExactlyOne<{ id: string }>(
      client,
      `SELECT id::text AS id FROM public.teams WHERE upper(abbreviation) = $1`,
      [pick.team_abbreviation],
    );

    if (action === "insert") {
      await executeSql(
        client,
        `INSERT INTO public.picks (week_id, user_id, team_id, result)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::public.pick_result)`,
        [weekId, pick.user_id, team.id, pick.result],
      );
    } else if (action === "update") {
      await executeSql(
        client,
        `UPDATE public.picks
         SET team_id = $3::uuid, result = $4::public.pick_result
         WHERE week_id = $1::uuid AND user_id = $2::uuid`,
        [weekId, pick.user_id, team.id, pick.result],
      );
    } else if (action !== "skip") {
      throw new Error(`Missing pick plan action for ${pickKey}.`);
    }
  }
}

async function verifyPostWrite(
  client: pg.Client,
  document: BootstrapImportDocument,
  plan: Extract<BootstrapPlan, { ok: true }>,
): Promise<void> {
  const league = await queryExactlyOne<{ id: string }>(
    client,
    `SELECT id::text AS id FROM public.leagues WHERE slug = $1`,
    [document.league.slug],
  );

  const season = await queryExactlyOne<{ id: string; status: string }>(
    client,
    `SELECT id::text AS id, status::text AS status
     FROM public.seasons
     WHERE league_id = $1::uuid AND year = $2`,
    [league.id, document.season.year],
  );
  if (season.status !== document.season.status) {
    throw new Error(
      `Post-write verification failed: season status is ${season.status}.`,
    );
  }

  const rules = await queryExactlyOne<Record<string, number | boolean>>(
    client,
    `SELECT correct_regular_pick_points, best_record_bonus, longest_streak_bonus,
            survivor_bonus, wildcard_points, divisional_points, conference_points,
            superbowl_points, perfect_season_override
     FROM public.scoring_rules WHERE season_id = $1::uuid`,
    [season.id],
  );
  for (const [key, value] of Object.entries(document.scoring_rules)) {
    if (rules[key] !== value) {
      throw new Error(
        `Post-write verification failed: scoring_rules.${key} mismatch.`,
      );
    }
  }

  for (const member of plan.resolvedMembers) {
    const row = await queryExactlyOne<{ role: string; active: boolean }>(
      client,
      `SELECT role::text AS role, active
       FROM public.league_members
       WHERE league_id = $1::uuid AND user_id = $2::uuid`,
      [league.id, member.userId],
    );
    if (row.role !== member.role || row.active !== member.active) {
      throw new Error(
        `Post-write verification failed: membership mismatch for ${member.userId}.`,
      );
    }
  }

  const weeks = await queryRows<{
    week_number: number;
    status: string;
    label: string;
  }>(
    client,
    `SELECT week_number, status::text AS status, label
     FROM public.weeks WHERE season_id = $1::uuid ORDER BY week_number`,
    [season.id],
  );
  if (weeks.length !== document.season.regular_week_count) {
    throw new Error(
      `Post-write verification failed: expected ${document.season.regular_week_count} weeks, found ${weeks.length}.`,
    );
  }
  const weekNumbers = new Set(weeks.map((week) => week.week_number));
  for (let n = 1; n <= document.season.regular_week_count; n += 1) {
    if (!weekNumbers.has(n)) {
      throw new Error(`Post-write verification failed: missing week ${n}.`);
    }
  }

  const openWeeks = weeks.filter((week) => week.status === "open");
  if (openWeeks.length !== 1) {
    throw new Error(
      `Post-write verification failed: expected exactly one open week, found ${openWeeks.length}.`,
    );
  }

  const week1 = weeks.find((week) => week.week_number === 1);
  if (!week1 || (week1.status !== "locked" && week1.status !== "final")) {
    throw new Error(
      "Post-write verification failed: Week 1 must be locked or final.",
    );
  }

  for (const expected of plan.preparedWeeks) {
    const actual = weeks.find(
      (week) => week.week_number === expected.week_number,
    );
    if (
      !actual ||
      actual.status !== expected.status ||
      actual.label !== expected.label
    ) {
      throw new Error(
        `Post-write verification failed: week ${expected.week_number} status/label mismatch.`,
      );
    }
  }

  const weekIdRows = await queryRows<{ id: string; week_number: number }>(
    client,
    `SELECT id::text AS id, week_number FROM public.weeks WHERE season_id = $1::uuid`,
    [season.id],
  );
  const weekIdByNumber = new Map(
    weekIdRows.map((row) => [row.week_number, row.id]),
  );

  for (const pick of plan.preparedPicks) {
    const weekId = weekIdByNumber.get(pick.week_number);
    if (!weekId) {
      throw new Error(
        `Post-write verification failed: week ${pick.week_number} missing.`,
      );
    }
    const row = await queryExactlyOne<{
      team_abbreviation: string;
      result: string;
      dup_count: string;
    }>(
      client,
      `SELECT upper(t.abbreviation) AS team_abbreviation,
              p.result::text AS result,
              (
                SELECT count(*)::text
                FROM public.picks p2
                WHERE p2.week_id = p.week_id AND p2.user_id = p.user_id
              ) AS dup_count
       FROM public.picks p
       INNER JOIN public.teams t ON t.id = p.team_id
       WHERE p.week_id = $1::uuid AND p.user_id = $2::uuid`,
      [weekId, pick.user_id],
    );
    if (row.team_abbreviation !== pick.team_abbreviation) {
      throw new Error(
        `Post-write verification failed: pick team mismatch week ${pick.week_number} user ${pick.user_id}.`,
      );
    }
    if (row.result !== pick.result) {
      throw new Error(
        `Post-write verification failed: pick result mismatch week ${pick.week_number} user ${pick.user_id}.`,
      );
    }
    if (Number(row.dup_count) !== 1) {
      throw new Error(
        `Post-write verification failed: duplicate pick for week ${pick.week_number} user ${pick.user_id}.`,
      );
    }
  }

  const reuse = await queryMaybeOne<{
    user_id: string;
    team_id: string;
    c: string;
  }>(
    client,
    `SELECT p.user_id::text AS user_id, p.team_id::text AS team_id, count(*)::text AS c
     FROM public.picks p
     INNER JOIN public.weeks w ON w.id = p.week_id
     WHERE w.season_id = $1::uuid
     GROUP BY p.user_id, p.team_id
     HAVING count(*) > 1
     LIMIT 1`,
    [season.id],
  );
  if (reuse) {
    throw new Error(
      `Post-write verification failed: team reuse for user ${reuse.user_id}.`,
    );
  }
}

/**
 * Dry-run against live DB inside a SERIALIZABLE read-only transaction.
 * Always rolls back; never writes.
 */
export async function dryRunBootstrapTransaction(options: {
  databaseUrl: string;
  document: BootstrapImportDocument;
  allowOverwrite: boolean;
}): Promise<BootstrapApplyResult> {
  const client = new pg.Client({ connectionString: options.databaseUrl });
  let began = false;
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    began = true;
    await acquireBootstrapLock(client, options.document);

    const resolved = await resolveAuthMembers(client, options.document);
    const snapshot = await loadBootstrapSnapshot(
      client,
      options.document,
      resolved,
    );
    const plan = planBootstrapImport({
      document: options.document,
      existing: snapshot,
      dryRun: true,
      allowOverwrite: options.allowOverwrite,
    });
    if (!plan.ok) {
      await client.query("ROLLBACK");
      began = false;
      return {
        ok: false,
        committed: false,
        rolledBack: true,
        error: plan.error,
        conflicts: plan.conflicts,
      };
    }

    await client.query("ROLLBACK");
    began = false;
    return {
      ok: true,
      committed: false,
      rolledBack: true,
      dryRun: true,
      counts: plan.counts,
      plan,
      report: formatPlanReport(plan),
    };
  } catch (error) {
    if (began) {
      await client.query("ROLLBACK");
    }
    return {
      ok: false,
      committed: false,
      rolledBack: began,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end();
  }
}

/**
 * Fully atomic bootstrap apply: SERIALIZABLE transaction, advisory lock,
 * snapshot + replan inside the transaction, writes, verify, then commit.
 */
export async function applyBootstrapTransaction(options: {
  databaseUrl: string;
  document: BootstrapImportDocument;
  allowOverwrite: boolean;
  testFailAfter?: BootstrapTestFailAfter | null;
}): Promise<BootstrapApplyResult> {
  const failAfter =
    options.testFailAfter === undefined
      ? readBootstrapTestFailAfter({ databaseUrl: options.databaseUrl })
      : options.testFailAfter;

  if (failAfter && !isLocalDatabaseUrl(options.databaseUrl)) {
    return {
      ok: false,
      committed: false,
      rolledBack: false,
      error: "Test failure injection refused: database host is not localhost.",
    };
  }

  const client = new pg.Client({ connectionString: options.databaseUrl });
  let began = false;
  let committed = false;
  try {
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    began = true;
    await acquireBootstrapLock(client, options.document);

    const resolved = await resolveAuthMembers(client, options.document);
    const snapshot = await loadBootstrapSnapshot(
      client,
      options.document,
      resolved,
    );
    const plan = planBootstrapImport({
      document: options.document,
      existing: snapshot,
      dryRun: false,
      allowOverwrite: options.allowOverwrite,
    });
    if (!plan.ok) {
      await client.query("ROLLBACK");
      began = false;
      return {
        ok: false,
        committed: false,
        rolledBack: true,
        error: plan.error,
        conflicts: plan.conflicts,
      };
    }

    await executeWrites(client, options.document, plan, failAfter);
    await verifyPostWrite(client, options.document, plan);
    if (failAfter === "verify") {
      assertTestHookOrThrow("verify");
    }

    await client.query("COMMIT");
    began = false;
    committed = true;

    return {
      ok: true,
      committed: true,
      rolledBack: false,
      dryRun: false,
      counts: plan.counts,
      plan,
      report: formatPlanReport(plan),
    };
  } catch (error) {
    let rolledBack = false;
    if (began && !committed) {
      await client.query("ROLLBACK");
      rolledBack = true;
    }
    return {
      ok: false,
      committed: false,
      rolledBack,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await client.end();
  }
}

export { advisoryLockKey };
