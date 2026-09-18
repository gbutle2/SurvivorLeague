/**
 * Transactional bootstrap import integration tests (local PostgreSQL only).
 *
 * Requires local Supabase: postgresql://postgres:postgres@127.0.0.1:54322/postgres
 * Never run against production.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import {
  applyBootstrapTransaction,
  dryRunBootstrapTransaction,
  advisoryLockKey,
} from "./bootstrap-apply.ts";
import type { BootstrapImportDocument } from "./bootstrap-schema.ts";
import { loadBootstrapSnapshot, resolveAuthMembers } from "./bootstrap-snapshot.ts";
import { BootstrapQueryError, queryRows } from "./pg-query.ts";

const DATABASE_URL =
  process.env.SUPABASE_DB_URL?.trim() ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function requireLocal(): void {
  const host = new URL(DATABASE_URL).hostname;
  assert.ok(
    host === "127.0.0.1" || host === "localhost",
    "Integration tests refuse non-local database hosts.",
  );
}

async function createAuthUser(
  client: pg.Client,
  options: { id: string; email: string; displayName?: string },
): Promise<void> {
  await client.query(
    `INSERT INTO auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at,
       raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous
     ) VALUES (
       '00000000-0000-0000-0000-000000000000', $1::uuid, 'authenticated', 'authenticated',
       $2, crypt('test-password', gen_salt('bf')),
       now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', $3::text),
       false, false, false
     )`,
    [options.id, options.email, options.displayName ?? "Player"],
  );
}

async function deleteAuthUser(client: pg.Client, userId: string): Promise<void> {
  await client.query(`DELETE FROM public.league_members WHERE user_id = $1::uuid`, [
    userId,
  ]);
  await client.query(`DELETE FROM public.picks WHERE user_id = $1::uuid`, [userId]);
  await client.query(`DELETE FROM public.profiles WHERE id = $1::uuid`, [userId]);
  await client.query(`DELETE FROM auth.users WHERE id = $1::uuid`, [userId]);
}

async function cleanupLeague(client: pg.Client, slug: string): Promise<void> {
  const league = await client.query<{ id: string }>(
    `SELECT id::text AS id FROM public.leagues WHERE slug = $1`,
    [slug],
  );
  if (league.rows[0]) {
    const leagueId = league.rows[0].id;
    const seasons = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM public.seasons WHERE league_id = $1::uuid`,
      [leagueId],
    );
    for (const season of seasons.rows) {
      await client.query(
        `DELETE FROM public.picks
         WHERE week_id IN (SELECT id FROM public.weeks WHERE season_id = $1::uuid)`,
        [season.id],
      );
      await client.query(`DELETE FROM public.weeks WHERE season_id = $1::uuid`, [
        season.id,
      ]);
      await client.query(`DELETE FROM public.scoring_rules WHERE season_id = $1::uuid`, [
        season.id,
      ]);
      await client.query(`DELETE FROM public.seasons WHERE id = $1::uuid`, [season.id]);
    }
    await client.query(`DELETE FROM public.league_members WHERE league_id = $1::uuid`, [
      leagueId,
    ]);
    await client.query(`DELETE FROM public.leagues WHERE id = $1::uuid`, [leagueId]);
  }
}

function buildDocument(options: {
  slug: string;
  year: number;
  commissionerId: string;
  playerId: string;
  commissionerName?: string;
  playerName?: string;
}): BootstrapImportDocument {
  const weeks = Array.from({ length: 17 }, (_, index) => {
    const weekNumber = index + 1;
    return {
      week_number: weekNumber,
      label: `Week ${weekNumber}`,
      lock_date:
        weekNumber === 1
          ? "2020-09-08"
          : `2099-09-${String(Math.min(7 + weekNumber, 28)).padStart(2, "0")}`,
      lock_time: "12:00",
      status:
        weekNumber === 1
          ? ("final" as const)
          : ("upcoming" as const),
    };
  });

  return {
    version: 1,
    league: {
      slug: options.slug,
      name: "Bootstrap Integration League",
      timezone: "America/Chicago",
    },
    season: {
      year: options.year,
      status: "active",
      regular_week_count: 17,
    },
    scoring_rules: {
      correct_regular_pick_points: 1,
      best_record_bonus: 4,
      longest_streak_bonus: 4,
      survivor_bonus: 10,
      wildcard_points: 2,
      divisional_points: 4,
      conference_points: 6,
      superbowl_points: 12,
      perfect_season_override: true,
    },
    members: [
      {
        auth_user_id: options.commissionerId,
        display_name: options.commissionerName ?? "Commissioner",
        role: "commissioner",
        active: true,
      },
      {
        auth_user_id: options.playerId,
        display_name: options.playerName ?? "Player Two",
        role: "player",
        active: true,
      },
    ],
    weeks,
    picks: [
      {
        week_number: 1,
        auth_user_id: options.commissionerId,
        team_abbreviation: "KC",
        result: "win",
      },
      {
        week_number: 1,
        auth_user_id: options.playerId,
        team_abbreviation: "BUF",
        result: "loss",
      },
    ],
  };
}

describe("transactional bootstrap import (local PostgreSQL)", () => {
  requireLocal();

  const suiteId = randomUUID().slice(0, 8);
  const commissionerId = randomUUID();
  const playerId = randomUUID();
  const slug = `bootstrap-it-${suiteId}`;
  const year = 2099;
  let admin: pg.Client;

  before(async () => {
    admin = new pg.Client({ connectionString: DATABASE_URL });
    await admin.connect();
    await createAuthUser(admin, {
      id: commissionerId,
      email: `comm-${suiteId}@example.test`,
      displayName: "Commissioner",
    });
    await createAuthUser(admin, {
      id: playerId,
      email: `player-${suiteId}@example.test`,
      displayName: "Player Two",
    });
  });

  after(async () => {
    await cleanupLeague(admin, slug);
    await deleteAuthUser(admin, commissionerId);
    await deleteAuthUser(admin, playerId);
    await admin.end();
  });

  it("dry-run performs zero writes", async () => {
    await cleanupLeague(admin, slug);
    const before = await admin.query(
      `SELECT count(*)::int AS c FROM public.leagues WHERE slug = $1`,
      [slug],
    );
    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });
    const result = await dryRunBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.dryRun, true);
    assert.equal(result.committed, false);
    assert.equal(result.rolledBack, true);
    const after = await admin.query(
      `SELECT count(*)::int AS c FROM public.leagues WHERE slug = $1`,
      [slug],
    );
    assert.equal(after.rows[0]!.c, before.rows[0]!.c);
    assert.equal(after.rows[0]!.c, 0);
  });

  it("successful apply commits the entire bootstrap", async () => {
    await cleanupLeague(admin, slug);
    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });
    const result = await applyBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
      testFailAfter: null,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.committed, true);
    assert.equal(result.rolledBack, false);
    assert.ok(result.counts.inserted > 0);

    const weeks = await admin.query(
      `SELECT count(*)::int AS c
       FROM public.weeks w
       INNER JOIN public.seasons s ON s.id = w.season_id
       INNER JOIN public.leagues l ON l.id = s.league_id
       WHERE l.slug = $1 AND s.year = $2`,
      [slug, year],
    );
    assert.equal(weeks.rows[0]!.c, 17);

    const open = await admin.query(
      `SELECT w.week_number
       FROM public.weeks w
       INNER JOIN public.seasons s ON s.id = w.season_id
       INNER JOIN public.leagues l ON l.id = s.league_id
       WHERE l.slug = $1 AND s.year = $2
         AND w.id = public.effective_current_week_id(s.id)`,
      [slug, year],
    );
    assert.equal(open.rows[0]!.week_number, 2);
  });

  it("forced failure after profile writes rolls back profiles", async () => {
    await cleanupLeague(admin, slug);
    // Ensure profiles are missing so import inserts them.
    await admin.query(`DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`, [
      [commissionerId, playerId],
    ]);

    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });
    const result = await applyBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
      testFailAfter: "profiles",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.rolledBack, true);
    assert.equal(result.committed, false);
    assert.match(result.error, /TEST_FAIL_AFTER=profiles/);

    const profiles = await admin.query(
      `SELECT count(*)::int AS c FROM public.profiles WHERE id = ANY($1::uuid[])`,
      [[commissionerId, playerId]],
    );
    assert.equal(profiles.rows[0]!.c, 0);

    const leagues = await admin.query(
      `SELECT count(*)::int AS c FROM public.leagues WHERE slug = $1`,
      [slug],
    );
    assert.equal(leagues.rows[0]!.c, 0);
  });

  it("forced failure after membership writes rolls back profiles and memberships", async () => {
    await cleanupLeague(admin, slug);
    await admin.query(`DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`, [
      [commissionerId, playerId],
    ]);

    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });
    const result = await applyBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
      testFailAfter: "memberships",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.rolledBack, true);

    const profiles = await admin.query(
      `SELECT count(*)::int AS c FROM public.profiles WHERE id = ANY($1::uuid[])`,
      [[commissionerId, playerId]],
    );
    assert.equal(profiles.rows[0]!.c, 0);

    const members = await admin.query(
      `SELECT count(*)::int AS c
       FROM public.league_members m
       INNER JOIN public.leagues l ON l.id = m.league_id
       WHERE l.slug = $1`,
      [slug],
    );
    assert.equal(members.rows[0]!.c, 0);
  });

  it("forced failure during week writes rolls back all prior entities", async () => {
    await cleanupLeague(admin, slug);
    // Recreate profiles via auth trigger path for subsequent league FK.
    await admin.query(`DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`, [
      [commissionerId, playerId],
    ]);
    // Re-insert profiles manually as matching display names so inserts happen
    // only for league/season/weeks as needed — actually memberships need profiles.
    // Leave profiles deleted so import inserts everything until week 3 fails.
    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });
    const result = await applyBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
      testFailAfter: "weeks",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.rolledBack, true);

    const leagues = await admin.query(
      `SELECT count(*)::int AS c FROM public.leagues WHERE slug = $1`,
      [slug],
    );
    assert.equal(leagues.rows[0]!.c, 0);
    const profiles = await admin.query(
      `SELECT count(*)::int AS c FROM public.profiles WHERE id = ANY($1::uuid[])`,
      [[commissionerId, playerId]],
    );
    assert.equal(profiles.rows[0]!.c, 0);
  });

  it("failed snapshot query aborts rather than treating data as absent", async () => {
    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });
    const real = new pg.Client({ connectionString: DATABASE_URL });
    await real.connect();
    try {
      const resolved = await resolveAuthMembers(real, document);
      const proxy = {
        query: async (sql: string, params?: unknown[]) => {
          if (/FROM public\.profiles/i.test(sql)) {
            throw new Error("simulated profiles query failure");
          }
          return real.query(sql, params);
        },
      };
      await assert.rejects(
        () => loadBootstrapSnapshot(proxy, document, resolved),
        (error: unknown) => {
          assert.ok(error instanceof BootstrapQueryError);
          assert.match(error.message, /Database query failed/);
          return true;
        },
      );
    } finally {
      await real.end();
    }
  });

  it("existing Auth user profile outside the league is detected correctly", async () => {
    await cleanupLeague(admin, slug);
    // Ensure profiles exist (from trigger or recreate).
    const existing = await admin.query(
      `SELECT id::text AS id, display_name FROM public.profiles WHERE id = $1::uuid`,
      [commissionerId],
    );
    if (existing.rows.length === 0) {
      await admin.query(
        `INSERT INTO public.profiles (id, display_name) VALUES ($1::uuid, $2)`,
        [commissionerId, "Commissioner"],
      );
    }
    if (
      (
        await admin.query(`SELECT 1 FROM public.profiles WHERE id = $1::uuid`, [
          playerId,
        ])
      ).rowCount === 0
    ) {
      await admin.query(
        `INSERT INTO public.profiles (id, display_name) VALUES ($1::uuid, $2)`,
        [playerId, "Player Two"],
      );
    }

    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });
    const result = await dryRunBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const profileMutations = result.plan.mutations.filter(
      (mutation) => mutation.entity === "profile",
    );
    assert.ok(profileMutations.every((mutation) => mutation.action === "skip"));
  });

  it("a conflicting display name blocks without --allow-overwrite", async () => {
    await cleanupLeague(admin, slug);
    await admin.query(
      `UPDATE public.profiles SET display_name = $2 WHERE id = $1::uuid`,
      [playerId, "Different Name"],
    );
    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
      playerName: "Player Two",
    });
    const result = await dryRunBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.error, /conflicting/i);
    assert.ok((result.conflicts?.length ?? 0) >= 1);

    // restore for later tests
    await admin.query(
      `UPDATE public.profiles SET display_name = $2 WHERE id = $1::uuid`,
      [playerId, "Player Two"],
    );
    await admin.query(
      `UPDATE public.profiles SET display_name = $2 WHERE id = $1::uuid`,
      [commissionerId, "Commissioner"],
    );
  });

  it("retrying an identical completed import performs no duplicate writes", async () => {
    await cleanupLeague(admin, slug);
    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });
    const first = await applyBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
      testFailAfter: null,
    });
    assert.equal(first.ok, true);

    const second = await applyBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
      testFailAfter: null,
    });
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.counts.inserted, 0);
    assert.equal(second.counts.updated, 0);
    assert.ok(second.counts.skipped > 0);

    const weeks = await admin.query(
      `SELECT count(*)::int AS c
       FROM public.weeks w
       INNER JOIN public.seasons s ON s.id = w.season_id
       INNER JOIN public.leagues l ON l.id = s.league_id
       WHERE l.slug = $1 AND s.year = $2`,
      [slug, year],
    );
    assert.equal(weeks.rows[0]!.c, 17);
  });

  it("changed database state is detected when apply replans", async () => {
    await cleanupLeague(admin, slug);
    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });

    // Seed a conflicting week label after dry-run would have planned inserts.
    const seeded = await applyBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
      testFailAfter: null,
    });
    assert.equal(seeded.ok, true);

    await admin.query(
      `UPDATE public.weeks w
       SET label = 'Tampered'
       FROM public.seasons s
       INNER JOIN public.leagues l ON l.id = s.league_id
       WHERE w.season_id = s.id AND l.slug = $1 AND s.year = $2 AND w.week_number = 5`,
      [slug, year],
    );

    const replan = await applyBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
      testFailAfter: null,
    });
    assert.equal(replan.ok, false);
    if (replan.ok) return;
    assert.match(replan.error, /conflicting/i);
    assert.equal(replan.rolledBack, true);
  });

  it("concurrent imports serialize through the advisory lock", async () => {
    await cleanupLeague(admin, slug);
    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });

    const holder = new pg.Client({ connectionString: DATABASE_URL });
    await holder.connect();
    await holder.query("BEGIN");
    await holder.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [advisoryLockKey(slug, year)],
    );

    let applyFinished = false;
    const applyPromise = applyBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
      testFailAfter: null,
    }).then((result) => {
      applyFinished = true;
      return result;
    });

    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.equal(applyFinished, false);

    await holder.query("ROLLBACK");
    await holder.end();

    const result = await applyPromise;
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.committed, true);
  });

  it("post-write verification failure rolls back everything", async () => {
    await cleanupLeague(admin, slug);
    await admin.query(`DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`, [
      [commissionerId, playerId],
    ]);

    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });
    const result = await applyBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
      testFailAfter: "verify",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.rolledBack, true);
    assert.match(result.error, /TEST_FAIL_AFTER=verify/);

    const leagues = await admin.query(
      `SELECT count(*)::int AS c FROM public.leagues WHERE slug = $1`,
      [slug],
    );
    assert.equal(leagues.rows[0]!.c, 0);
  });

  it("post-write deadline mismatch rolls back", async () => {
    await cleanupLeague(admin, slug);
    await admin.query(`DELETE FROM public.profiles WHERE id = ANY($1::uuid[])`, [
      [commissionerId, playerId],
    ]);
    const document = buildDocument({
      slug,
      year,
      commissionerId,
      playerId,
    });
    const result = await applyBootstrapTransaction({
      databaseUrl: DATABASE_URL,
      document,
      allowOverwrite: false,
      testFailAfter: "corrupt_week_deadline",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.rolledBack, true);
    assert.match(result.error, /locks_at mismatch/i);
    const leagues = await admin.query(
      `SELECT count(*)::int AS c FROM public.leagues WHERE slug = $1`,
      [slug],
    );
    assert.equal(leagues.rows[0]!.c, 0);
  });

  it("queryRows fail-closed helper does not return empty on error", async () => {
    const client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();
    try {
      await assert.rejects(
        () => queryRows(client, `SELECT * FROM public.not_a_real_table_xyz`),
        (error: unknown) => {
          assert.ok(error instanceof BootstrapQueryError);
          return true;
        },
      );
    } finally {
      await client.end();
    }
  });
});
