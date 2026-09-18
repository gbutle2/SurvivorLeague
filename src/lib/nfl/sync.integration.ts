/**
 * NFL schedule sync integration tests (local PostgreSQL only).
 * Requires: postgresql://postgres:postgres@127.0.0.1:54322/postgres
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import pg from "pg";

import { assertDedicatedSyncClient, syncNflSchedule } from "./sync.ts";

const DATABASE_URL =
  process.env.SUPABASE_DB_URL?.trim() ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const SEASON_YEAR = 2091;
const SLUG = `sync-it-${SEASON_YEAR}`;

function requireLocal(): void {
  const host = new URL(DATABASE_URL).hostname;
  assert.ok(
    host === "127.0.0.1" || host === "localhost",
    "Integration tests refuse non-local database hosts.",
  );
}

function sampleCsv(options?: {
  gameId?: string;
  homeScore?: string;
  awayScore?: string;
  gametime?: string;
}): string {
  const gameId = options?.gameId ?? `${SEASON_YEAR}_01_DAL_PHI`;
  const homeScore = options?.homeScore ?? "";
  const awayScore = options?.awayScore ?? "";
  const gametime = options?.gametime ?? "13:00";
  return [
    "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score",
    `${gameId},${SEASON_YEAR},REG,1,${SEASON_YEAR}-09-10,Thursday,${gametime},DAL,${awayScore},PHI,${homeScore}`,
    `${SEASON_YEAR}_02_KC_BUF,${SEASON_YEAR},REG,2,${SEASON_YEAR}-09-17,Thursday,20:20,KC,,BUF,`,
  ].join("\n");
}

describe("syncNflSchedule integration", () => {
  let client: pg.Client;
  let leagueId: string;
  let seasonId: string;
  let teamPhi: string;
  let teamDal: string;

  before(async () => {
    requireLocal();
    client = new pg.Client({ connectionString: DATABASE_URL });
    await client.connect();

    leagueId = randomUUID();
    seasonId = randomUUID();
    const commish = randomUUID();
    const email = `sync-commish-${SEASON_YEAR}@example.com`;

    await client.query(`DELETE FROM public.games WHERE season_year = $1`, [
      SEASON_YEAR,
    ]);
    await client.query(
      `DELETE FROM public.schedule_sync_runs WHERE season_year = $1`,
      [SEASON_YEAR],
    );
    await client.query(
      `DELETE FROM public.schedule_review_items WHERE season_year = $1`,
      [SEASON_YEAR],
    );

    const existingLeague = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM public.leagues WHERE slug = $1`,
      [SLUG],
    );
    if (existingLeague.rows[0]) {
      const oldLeagueId = existingLeague.rows[0].id;
      const seasons = await client.query<{ id: string }>(
        `SELECT id::text AS id FROM public.seasons WHERE league_id = $1::uuid`,
        [oldLeagueId],
      );
      for (const season of seasons.rows) {
        await client.query(
          `DELETE FROM public.playoff_rounds WHERE season_id = $1::uuid`,
          [season.id],
        );
        await client.query(`DELETE FROM public.weeks WHERE season_id = $1::uuid`, [
          season.id,
        ]);
      }
      await client.query(`DELETE FROM public.seasons WHERE league_id = $1::uuid`, [
        oldLeagueId,
      ]);
      await client.query(
        `DELETE FROM public.league_members WHERE league_id = $1::uuid`,
        [oldLeagueId],
      );
      await client.query(`DELETE FROM public.leagues WHERE id = $1::uuid`, [
        oldLeagueId,
      ]);
    }

    await client.query(`DELETE FROM auth.users WHERE email = $1`, [email]);

    await client.query(
      `INSERT INTO auth.users (
         instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, is_super_admin, is_sso_user, is_anonymous
       ) VALUES (
         '00000000-0000-0000-0000-000000000000', $1::uuid, 'authenticated', 'authenticated',
         $2, crypt('x', gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         '{"display_name":"Sync Commish"}'::jsonb,
         false, false, false
       )`,
      [commish, email],
    );

    await client.query(
      `INSERT INTO public.leagues (id, name, slug, timezone, commissioner_user_id)
       VALUES ($1::uuid, 'Sync IT League', $2, 'America/Chicago', $3::uuid)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [leagueId, SLUG, commish],
    );
    const league = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM public.leagues WHERE slug = $1`,
      [SLUG],
    );
    leagueId = league.rows[0]!.id;

    await client.query(
      `INSERT INTO public.league_members (league_id, user_id, role, active)
       VALUES ($1::uuid, $2::uuid, 'commissioner', true)
       ON CONFLICT DO NOTHING`,
      [leagueId, commish],
    );

    await client.query(
      `INSERT INTO public.seasons (id, league_id, year, status, regular_week_count)
       VALUES ($1::uuid, $2::uuid, $3, 'setup', 18)
       ON CONFLICT (league_id, year) DO UPDATE SET status = 'setup'
       RETURNING id`,
      [seasonId, leagueId, SEASON_YEAR],
    );
    const season = await client.query<{ id: string }>(
      `SELECT id::text AS id FROM public.seasons WHERE league_id = $1::uuid AND year = $2`,
      [leagueId, SEASON_YEAR],
    );
    seasonId = season.rows[0]!.id;

    const teams = await client.query<{ id: string; abbreviation: string }>(
      `SELECT id::text AS id, abbreviation FROM public.teams
       WHERE abbreviation IN ('PHI','DAL')`,
    );
    teamPhi = teams.rows.find((t) => t.abbreviation === "PHI")!.id;
    teamDal = teams.rows.find((t) => t.abbreviation === "DAL")!.id;
  });

  after(async () => {
    await client.query(`DELETE FROM public.games WHERE season_year = $1`, [
      SEASON_YEAR,
    ]);
    await client.query(
      `DELETE FROM public.schedule_sync_runs WHERE season_year = $1`,
      [SEASON_YEAR],
    );
    await client.query(
      `DELETE FROM public.schedule_review_items WHERE season_year = $1`,
      [SEASON_YEAR],
    );
    await client.query(
      `DELETE FROM public.playoff_rounds WHERE season_id = $1::uuid`,
      [seasonId],
    );
    await client.query(`DELETE FROM public.weeks WHERE season_id = $1::uuid`, [
      seasonId,
    ]);
    await client.query(`DELETE FROM public.seasons WHERE id = $1::uuid`, [
      seasonId,
    ]);
    await client.query(`DELETE FROM public.league_members WHERE league_id = $1::uuid`, [
      leagueId,
    ]);
    await client.query(`DELETE FROM public.leagues WHERE id = $1::uuid`, [
      leagueId,
    ]);
    await client.query(
      `DELETE FROM auth.users WHERE email = $1`,
      [`sync-commish-${SEASON_YEAR}@example.com`],
    );
    await client.end();
  });

  it("success changes and audit commit together", async () => {
    await client.query(`DELETE FROM public.games WHERE season_year = $1`, [
      SEASON_YEAR,
    ]);
    await client.query(
      `DELETE FROM public.schedule_sync_runs WHERE season_year = $1`,
      [SEASON_YEAR],
    );

    const result = await syncNflSchedule(client, {
      seasonYear: SEASON_YEAR,
      leagueSeasonId: seasonId,
      csvText: sampleCsv(),
      sourceFreshnessAt: "2026-09-01T12:00:00.000Z",
    });

    assert.equal(result.status, "succeeded");
    assert.ok(result.runId);
    assert.ok(result.inserted >= 2);

    const games = await client.query(
      `SELECT count(*)::int AS n FROM public.games WHERE season_year = $1`,
      [SEASON_YEAR],
    );
    assert.ok((games.rows[0] as { n: number }).n >= 2);

    const runs = await client.query(
      `SELECT status FROM public.schedule_sync_runs WHERE id = $1::uuid`,
      [result.runId],
    );
    assert.equal((runs.rows[0] as { status: string }).status, "succeeded");

    const weeks = await client.query(
      `SELECT count(*)::int AS n FROM public.weeks WHERE season_id = $1::uuid`,
      [seasonId],
    );
    assert.equal((weeks.rows[0] as { n: number }).n, 18);
  });

  it("injected success-audit failure rolls back all changes", async () => {
    await client.query(`DELETE FROM public.games WHERE season_year = $1`, [
      SEASON_YEAR,
    ]);
    await client.query(
      `DELETE FROM public.schedule_sync_runs WHERE season_year = $1`,
      [SEASON_YEAR],
    );

    const marker = `${SEASON_YEAR}_rollback_marker`;
    const result = await syncNflSchedule(client, {
      seasonYear: SEASON_YEAR,
      leagueSeasonId: seasonId,
      csvText: sampleCsv({ gameId: marker }),
      sourceFreshnessAt: null,
      failBeforeSuccessAudit: true,
    });

    assert.equal(result.status, "failed");
    assert.match(result.errorSummary ?? "", /Injected success-audit failure/);

    const games = await client.query(
      `SELECT count(*)::int AS n FROM public.games
       WHERE season_year = $1 AND provider_game_id = $2`,
      [SEASON_YEAR, marker],
    );
    assert.equal((games.rows[0] as { n: number }).n, 0);

    const successRuns = await client.query(
      `SELECT count(*)::int AS n FROM public.schedule_sync_runs
       WHERE season_year = $1 AND status = 'succeeded'`,
      [SEASON_YEAR],
    );
    assert.equal((successRuns.rows[0] as { n: number }).n, 0);
  });

  it("provider validation failure makes no schedule changes", async () => {
    await client.query(`DELETE FROM public.games WHERE season_year = $1`, [
      SEASON_YEAR,
    ]);

    const before = await client.query(
      `SELECT count(*)::int AS n FROM public.games WHERE season_year = $1`,
      [SEASON_YEAR],
    );

    const result = await syncNflSchedule(client, {
      seasonYear: SEASON_YEAR,
      leagueSeasonId: seasonId,
      csvText: "not,a,valid,header\n1,2,3,4\n",
      sourceFreshnessAt: null,
    });

    assert.ok(result.status === "failed" || result.status === "rejected");
    const after = await client.query(
      `SELECT count(*)::int AS n FROM public.games WHERE season_year = $1`,
      [SEASON_YEAR],
    );
    assert.equal(
      (after.rows[0] as { n: number }).n,
      (before.rows[0] as { n: number }).n,
    );
  });

  it("overlapping sync attempts serialize or reject safely", async () => {
    await client.query(`DELETE FROM public.games WHERE season_year = $1`, [
      SEASON_YEAR,
    ]);

    const clientB = new pg.Client({ connectionString: DATABASE_URL });
    await clientB.connect();
    try {
      await client.query("BEGIN");
      const lockKey = 420_000_000 + (SEASON_YEAR % 100_000);
      await client.query(`SELECT pg_advisory_xact_lock($1)`, [lockKey]);

      const raced = syncNflSchedule(clientB, {
        seasonYear: SEASON_YEAR,
        leagueSeasonId: seasonId,
        csvText: sampleCsv({ gameId: `${SEASON_YEAR}_race` }),
        sourceFreshnessAt: null,
      });

      const result = await raced;
      assert.equal(result.status, "rejected");
      assert.match(result.errorSummary ?? "", /already running/i);

      await client.query("ROLLBACK");
    } finally {
      await clientB.end();
    }
  });

  it("cannot use mixed pool connections", async () => {
    const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 2 });
    try {
      assert.throws(
        () => assertDedicatedSyncClient(pool as never),
        /dedicated pg\.Client/i,
      );
      await assert.rejects(
        () =>
          syncNflSchedule(pool as never, {
            seasonYear: SEASON_YEAR,
            csvText: sampleCsv(),
            sourceFreshnessAt: null,
          }),
        /dedicated pg\.Client/i,
      );
    } finally {
      await pool.end();
    }
  });

  it("manual_override freezes provider-managed fields on later sync", async () => {
    await client.query(`DELETE FROM public.games WHERE season_year = $1`, [
      SEASON_YEAR,
    ]);

    const first = await syncNflSchedule(client, {
      seasonYear: SEASON_YEAR,
      leagueSeasonId: seasonId,
      csvText: sampleCsv({
        gameId: `${SEASON_YEAR}_override`,
        homeScore: "10",
        awayScore: "7",
      }),
      sourceFreshnessAt: null,
    });
    assert.equal(first.status, "succeeded");

    await client.query(
      `UPDATE public.games
       SET manual_override = true,
           home_score = 99,
           away_score = 1,
           winner_team_id = $1::uuid
       WHERE provider_game_id = $2`,
      [teamPhi, `${SEASON_YEAR}_override`],
    );

    const second = await syncNflSchedule(client, {
      seasonYear: SEASON_YEAR,
      leagueSeasonId: seasonId,
      csvText: sampleCsv({
        gameId: `${SEASON_YEAR}_override`,
        homeScore: "3",
        awayScore: "21",
        gametime: "16:25",
      }),
      sourceFreshnessAt: null,
    });
    assert.equal(second.status, "succeeded");
    assert.ok(second.skipped >= 1);

    const row = await client.query<{
      home_score: number;
      away_score: number;
      winner_team_id: string;
      scheduled_kickoff_at: Date;
    }>(
      `SELECT home_score, away_score, winner_team_id::text, scheduled_kickoff_at
       FROM public.games WHERE provider_game_id = $1`,
      [`${SEASON_YEAR}_override`],
    );
    assert.equal(row.rows[0]!.home_score, 99);
    assert.equal(row.rows[0]!.away_score, 1);
    assert.equal(row.rows[0]!.winner_team_id, teamPhi);
    // Kickoff frozen at original Eastern 13:00 → 17:00Z (EDT in September).
    assert.equal(
      new Date(row.rows[0]!.scheduled_kickoff_at).toISOString(),
      `${SEASON_YEAR}-09-10T17:00:00.000Z`,
    );
    void teamDal;
  });
});
