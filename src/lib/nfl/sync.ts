import type pg from "pg";

import { csvToObjects } from "./csv.ts";
import { parseProviderGames, type ParsedProviderGame } from "./parse-schedule.ts";
import {
  NFLVERSE_FETCH_TIMEOUT_MS,
  NFLVERSE_MAX_BYTES,
  NFLVERSE_PROVIDER,
  NFLVERSE_SCHEDULES_CSV_URL,
  NFLVERSE_TIMESTAMP_URL,
} from "./provider.ts";

export type SyncResult = {
  runId: string;
  status: "succeeded" | "failed" | "rejected";
  inserted: number;
  updated: number;
  skipped: number;
  rejected: number;
  sourceFreshnessAt: string | null;
  errorSummary: string | null;
  warningSummary: string | null;
};

type TeamRow = { id: string; abbreviation: string };
type GameRow = {
  id: string;
  provider_game_id: string;
  scheduled_kickoff_at: Date;
  status: string;
  manual_override: boolean;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: string | null;
  home_team_id: string;
  away_team_id: string;
  season_type: string;
  regular_week_number: number | null;
  playoff_round: string | null;
};

/**
 * Dedicated connection for schedule sync transactions.
 * Intentionally incompatible with pg.Pool (Pools expose totalCount).
 */
export type NflSyncClient = Pick<pg.Client, "query"> & {
  totalCount?: never;
};

export type SyncNflScheduleOptions = {
  seasonYear: number;
  leagueSeasonId?: string | null;
  now?: Date;
  /** Injected CSV body for tests; production fetches the fixed URL. */
  csvText?: string;
  /** Injected freshness ISO for tests. */
  sourceFreshnessAt?: string | null;
  /** Test-only: throw after schedule writes, before success audit insert. */
  failBeforeSuccessAudit?: boolean;
};

export function assertDedicatedSyncClient(client: NflSyncClient): void {
  const maybePool = client as unknown as { totalCount?: unknown };
  if (typeof maybePool.totalCount === "number") {
    throw new Error(
      "syncNflSchedule requires a dedicated pg.Client, not a pg.Pool",
    );
  }
}

async function fetchText(
  url: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "text/csv,application/json,*/*" },
      redirect: "follow",
    });
    if (!response.ok) {
      throw new Error(`Provider HTTP ${response.status} for ${url}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) {
      throw new Error(
        `Provider response exceeded ${maxBytes} bytes (${buffer.byteLength})`,
      );
    }
    return buffer.toString("utf8");
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSourceFreshness(): Promise<string | null> {
  try {
    const raw = await fetchText(
      NFLVERSE_TIMESTAMP_URL,
      NFLVERSE_FETCH_TIMEOUT_MS,
      4_096,
    );
    const parsed = JSON.parse(raw) as { last_updated?: string };
    if (!parsed.last_updated) return null;
    const asDate = new Date(parsed.last_updated);
    return Number.isNaN(asDate.getTime()) ? null : asDate.toISOString();
  } catch {
    return null;
  }
}

function winnerId(
  game: ParsedProviderGame,
  byAbbrev: Map<string, string>,
): string | null {
  if (!game.winnerAbbreviation) return null;
  return byAbbrev.get(game.winnerAbbreviation) ?? null;
}

async function insertSyncRun(
  client: NflSyncClient,
  args: {
    seasonYear: number;
    status: "succeeded" | "failed" | "rejected";
    inserted?: number;
    updated?: number;
    skipped?: number;
    rejected?: number;
    sourceFreshnessAt: string | null;
    errorSummary?: string | null;
    warningSummary?: string | null;
  },
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO public.schedule_sync_runs (
       provider, season_year, status, completed_at,
       inserted_count, updated_count, skipped_count, rejected_count,
       source_freshness_at, error_summary, warning_summary
     ) VALUES (
       $1, $2, $3, now(),
       $4, $5, $6, $7,
       $8, $9, $10
     )
     RETURNING id`,
    [
      NFLVERSE_PROVIDER,
      args.seasonYear,
      args.status,
      args.inserted ?? 0,
      args.updated ?? 0,
      args.skipped ?? 0,
      args.rejected ?? 0,
      args.sourceFreshnessAt,
      args.errorSummary ?? null,
      args.warningSummary ?? null,
    ],
  );
  return result.rows[0]!.id;
}

async function writeFailureAuditBestEffort(
  client: NflSyncClient,
  args: Parameters<typeof insertSyncRun>[1],
): Promise<string> {
  try {
    await client.query("BEGIN");
    const runId = await insertSyncRun(client, args);
    await client.query("COMMIT");
    return runId;
  } catch {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    return "";
  }
}

async function applyAutomaticPickResults(
  client: NflSyncClient,
  seasonYear: number,
): Promise<void> {
  // Regular picks: pending + auto source only (never overwrite commissioner).
  await client.query(
    `UPDATE public.picks p
     SET result = CASE
           WHEN g.winner_team_id IS NULL THEN 'tie'::public.pick_result
           WHEN g.winner_team_id = p.team_id THEN 'win'::public.pick_result
           ELSE 'loss'::public.pick_result
         END,
         result_source = 'auto',
         game_id = g.id,
         updated_at = now()
     FROM public.weeks w
     INNER JOIN public.seasons s ON s.id = w.season_id
     INNER JOIN public.games g
       ON g.season_year = s.year
      AND g.season_type = 'regular'
      AND g.regular_week_number = w.week_number
      AND g.status = 'final'
      AND g.manual_override = false
     WHERE p.week_id = w.id
       AND s.year = $1
       AND (g.home_team_id = p.team_id OR g.away_team_id = p.team_id)
       AND p.result = 'pending'
       AND p.result_source = 'auto'`,
    [seasonYear],
  );

  await client.query(
    `UPDATE public.playoff_picks pp
     SET result = CASE
           WHEN g.winner_team_id IS NULL THEN 'tie'::public.pick_result
           WHEN g.winner_team_id = pp.team_id THEN 'win'::public.pick_result
           ELSE 'loss'::public.pick_result
         END,
         points_awarded = CASE
           WHEN g.winner_team_id = pp.team_id THEN pr.points
           ELSE 0
         END,
         result_source = 'auto',
         game_id = g.id,
         updated_at = now()
     FROM public.playoff_rounds pr
     INNER JOIN public.seasons s ON s.id = pr.season_id
     INNER JOIN public.games g
       ON g.season_year = s.year
      AND g.season_type = 'postseason'
      AND g.playoff_round = pr.round_code
      AND g.status = 'final'
      AND g.manual_override = false
     WHERE pp.playoff_round_id = pr.id
       AND s.year = $1
       AND (g.home_team_id = pp.team_id OR g.away_team_id = pp.team_id)
       AND pp.result = 'pending'
       AND pp.result_source = 'auto'`,
    [seasonYear],
  );
}

/**
 * Atomic NFL schedule sync for one season year.
 *
 * Network fetch/validate happens BEFORE BEGIN so provider I/O never holds a
 * database transaction. Success audit is written inside the same transaction
 * as schedule/result changes; failure of that insert rolls everything back.
 */
export async function syncNflSchedule(
  client: NflSyncClient,
  options: SyncNflScheduleOptions,
): Promise<SyncResult> {
  assertDedicatedSyncClient(client);

  const now = options.now ?? new Date();
  const seasonYear = options.seasonYear;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let rejected = 0;
  let sourceFreshnessAt: string | null = options.sourceFreshnessAt ?? null;
  let warningSummary: string | null = null;

  // --- Fetch + validate outside any transaction ---
  let parsed: ParsedProviderGame[] = [];
  let rejects: Awaited<ReturnType<typeof parseProviderGames>>["rejects"] = [];

  try {
    if (options.sourceFreshnessAt === undefined) {
      sourceFreshnessAt = await fetchSourceFreshness();
    }
    const csvText =
      options.csvText ??
      (await fetchText(
        NFLVERSE_SCHEDULES_CSV_URL,
        NFLVERSE_FETCH_TIMEOUT_MS,
        NFLVERSE_MAX_BYTES,
      ));
    const rows = csvToObjects(csvText);
    const parsedResult = parseProviderGames(rows, seasonYear);
    parsed = parsedResult.games;
    rejects = parsedResult.rejects;
    rejected = rejects.length;
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 2000) : String(error);
    const runId = await writeFailureAuditBestEffort(client, {
      seasonYear,
      status: "failed",
      rejected: 0,
      sourceFreshnessAt,
      errorSummary: message,
    });
    return {
      runId,
      status: "failed",
      inserted: 0,
      updated: 0,
      skipped: 0,
      rejected: 0,
      sourceFreshnessAt,
      errorSummary: message,
      warningSummary: null,
    };
  }

  if (parsed.length === 0) {
    const summary = `No valid games for season ${seasonYear}. Rejects: ${rejects.length}`;
    const runId = await writeFailureAuditBestEffort(client, {
      seasonYear,
      status: "rejected",
      rejected,
      sourceFreshnessAt,
      errorSummary: summary,
    });
    return {
      runId,
      status: "rejected",
      inserted: 0,
      updated: 0,
      skipped: 0,
      rejected,
      sourceFreshnessAt,
      errorSummary: summary,
      warningSummary: null,
    };
  }

  const fatalRejects = rejects.filter(
    (r) =>
      r.reason.includes("Duplicate") ||
      r.reason.includes("Missing required") ||
      r.reason.includes("Empty schedule"),
  );
  if (fatalRejects.length > 0) {
    const message = `Fatal provider validation: ${fatalRejects
      .map((r) => r.reason)
      .join("; ")}`;
    const runId = await writeFailureAuditBestEffort(client, {
      seasonYear,
      status: "failed",
      rejected,
      sourceFreshnessAt,
      errorSummary: message,
    });
    return {
      runId,
      status: "failed",
      inserted: 0,
      updated: 0,
      skipped: 0,
      rejected,
      sourceFreshnessAt,
      errorSummary: message,
      warningSummary: null,
    };
  }

  // --- Apply inside one client transaction ---
  await client.query("BEGIN");
  try {
    const lockKey = 420_000_000 + (seasonYear % 100_000);
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1) AS locked",
      [lockKey],
    );
    if (!lock.rows[0]?.locked) {
      await client.query("ROLLBACK");
      const runId = await writeFailureAuditBestEffort(client, {
        seasonYear,
        status: "rejected",
        rejected: 0,
        sourceFreshnessAt,
        errorSummary:
          "Another schedule sync is already running for this season.",
      });
      return {
        runId,
        status: "rejected",
        inserted: 0,
        updated: 0,
        skipped: 0,
        rejected: 0,
        sourceFreshnessAt,
        errorSummary:
          "Another schedule sync is already running for this season.",
        warningSummary: null,
      };
    }

    // Revalidate team map against current DB state under the lock.
    const teams = await client.query<TeamRow>(
      "SELECT id, abbreviation FROM public.teams WHERE active = true",
    );
    const byAbbrev = new Map(
      teams.rows.map((t) => [t.abbreviation, t.id] as const),
    );

    const unknown: string[] = [];
    for (const game of parsed) {
      if (!byAbbrev.has(game.homeAbbreviation)) {
        unknown.push(game.homeAbbreviation);
      }
      if (!byAbbrev.has(game.awayAbbreviation)) {
        unknown.push(game.awayAbbreviation);
      }
    }
    if (unknown.length > 0) {
      throw new Error(
        `Unknown team abbreviations: ${[...new Set(unknown)].join(", ")}`,
      );
    }

    const existing = await client.query<GameRow>(
      `SELECT id, provider_game_id, scheduled_kickoff_at, status, manual_override,
              home_score, away_score, winner_team_id,
              home_team_id, away_team_id, season_type, regular_week_number, playoff_round
       FROM public.games
       WHERE provider = $1 AND season_year = $2`,
      [NFLVERSE_PROVIDER, seasonYear],
    );
    const existingByProvider = new Map(
      existing.rows.map((g) => [g.provider_game_id, g] as const),
    );

    const warnings: string[] = [];

    for (const game of parsed) {
      const homeId = byAbbrev.get(game.homeAbbreviation)!;
      const awayId = byAbbrev.get(game.awayAbbreviation)!;
      const winId = winnerId(game, byAbbrev);
      const prior = existingByProvider.get(game.providerGameId);

      if (!prior) {
        await client.query(
          `INSERT INTO public.games (
             provider, provider_game_id, season_year, season_type,
             regular_week_number, playoff_round, home_team_id, away_team_id,
             scheduled_kickoff_at, status, home_score, away_score, winner_team_id,
             last_synced_at
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11,$12,$13, now()
           )`,
          [
            NFLVERSE_PROVIDER,
            game.providerGameId,
            game.seasonYear,
            game.seasonType,
            game.regularWeekNumber,
            game.playoffRound,
            homeId,
            awayId,
            game.scheduledKickoffAt,
            game.status,
            game.homeScore,
            game.awayScore,
            winId,
          ],
        );
        inserted += 1;
        continue;
      }

      /**
       * manual_override freezes ALL provider-managed schedule/result fields.
       * Only last_synced_at advances so operators can see the sync attempted.
       */
      if (prior.manual_override) {
        skipped += 1;
        warnings.push(
          `Preserved manual override (schedule+result frozen) for ${game.providerGameId}`,
        );
        await client.query(
          `UPDATE public.games SET last_synced_at = now() WHERE id = $1`,
          [prior.id],
        );
        continue;
      }

      const storedKickoff = new Date(prior.scheduled_kickoff_at);
      const providerKickoff = new Date(game.scheduledKickoffAt);
      const kickoffLocked = storedKickoff.getTime() <= now.getTime();
      let nextKickoff = storedKickoff.toISOString();

      if (providerKickoff.getTime() !== storedKickoff.getTime()) {
        if (kickoffLocked) {
          await client.query(
            `INSERT INTO public.schedule_review_items
               (season_year, game_id, provider_game_id, kind, summary, old_value, new_value)
             VALUES ($1,$2,$3,'post_kickoff_time_change',$4,$5,$6)`,
            [
              seasonYear,
              prior.id,
              game.providerGameId,
              "Provider kickoff changed after stored kickoff; not applied",
              storedKickoff.toISOString(),
              providerKickoff.toISOString(),
            ],
          );
          warnings.push(
            `Post-kickoff schedule change flagged for ${game.providerGameId}`,
          );
        } else {
          nextKickoff = providerKickoff.toISOString();
        }
      }

      // Provider CSV does not reliably encode cancellations; flag when status
      // would change to canceled only if we ever receive that signal.
      if (game.status === "canceled" && prior.status !== "canceled") {
        await client.query(
          `INSERT INTO public.schedule_review_items
             (season_year, game_id, provider_game_id, kind, summary, old_value, new_value)
           VALUES ($1,$2,$3,'canceled_game',$4,$5,$6)`,
          [
            seasonYear,
            prior.id,
            game.providerGameId,
            "Canceled/no-contest signal received; commissioner resolution required",
            prior.status,
            game.status,
          ],
        );
        warnings.push(`Canceled game flagged for ${game.providerGameId}`);
      }

      await client.query(
        `UPDATE public.games
         SET season_type = $2,
             regular_week_number = $3,
             playoff_round = $4,
             home_team_id = $5,
             away_team_id = $6,
             scheduled_kickoff_at = $7::timestamptz,
             status = $8,
             home_score = $9,
             away_score = $10,
             winner_team_id = $11,
             last_synced_at = now()
         WHERE id = $1`,
        [
          prior.id,
          game.seasonType,
          game.regularWeekNumber,
          game.playoffRound,
          homeId,
          awayId,
          nextKickoff,
          game.status,
          game.homeScore,
          game.awayScore,
          winId,
        ],
      );
      updated += 1;
    }

    const seasons = options.leagueSeasonId
      ? await client.query<{ id: string; year: number }>(
          `SELECT id, year FROM public.seasons WHERE id = $1`,
          [options.leagueSeasonId],
        )
      : await client.query<{ id: string; year: number }>(
          `SELECT id, year FROM public.seasons WHERE year = $1`,
          [seasonYear],
        );

    for (const season of seasons.rows) {
      if (season.year !== seasonYear) continue;
      await client.query(
        `UPDATE public.seasons SET regular_week_count = 17 WHERE id = $1`,
        [season.id],
      );

      // NFL schedule still has Weeks 1–18; competition length is regular_week_count (17).
      // Extra week rows are retained and not deleted.
      for (let week = 1; week <= 18; week += 1) {
        const earliest = await client.query<{ kickoff: Date | null }>(
          `SELECT min(scheduled_kickoff_at) AS kickoff
           FROM public.games
           WHERE season_year = $1
             AND season_type = 'regular'
             AND regular_week_number = $2
             AND status <> 'canceled'`,
          [seasonYear, week],
        );
        const kickoff =
          earliest.rows[0]?.kickoff ??
          new Date(Date.UTC(seasonYear, 8, 1 + (week - 1) * 7));

        await client.query(
          `INSERT INTO public.weeks (season_id, week_number, label, locks_at, status)
           VALUES ($1, $2, $3, $4::timestamptz, 'upcoming')
           ON CONFLICT (season_id, week_number) DO UPDATE
           SET label = EXCLUDED.label,
               locks_at = EXCLUDED.locks_at`,
          [season.id, week, `Week ${week}`, kickoff.toISOString()],
        );
      }

      const roundDefs: Array<{
        number: number;
        code: string;
        name: string;
        points: number;
      }> = [
        { number: 1, code: "wildcard", name: "Wild Card", points: 1 },
        { number: 2, code: "divisional", name: "Divisional", points: 2 },
        { number: 3, code: "conference", name: "Conference", points: 3 },
        { number: 4, code: "superbowl", name: "Super Bowl", points: 4 },
      ];

      for (const round of roundDefs) {
        const earliest = await client.query<{ kickoff: Date | null }>(
          `SELECT min(scheduled_kickoff_at) AS kickoff
           FROM public.games
           WHERE season_year = $1
             AND season_type = 'postseason'
             AND playoff_round = $2::public.playoff_round_code
             AND status <> 'canceled'`,
          [seasonYear, round.code],
        );
        const kickoff =
          earliest.rows[0]?.kickoff ??
          new Date(Date.UTC(seasonYear + 1, 0, 10 + round.number));

        await client.query(
          `INSERT INTO public.playoff_rounds
             (season_id, round_number, round_code, name, points, locks_at, status)
           VALUES ($1,$2,$3::public.playoff_round_code,$4,$5,$6::timestamptz,'upcoming')
           ON CONFLICT (season_id, round_number) DO UPDATE
           SET round_code = EXCLUDED.round_code,
               name = EXCLUDED.name,
               points = EXCLUDED.points,
               locks_at = EXCLUDED.locks_at`,
          [
            season.id,
            round.number,
            round.code,
            round.name,
            round.points,
            kickoff.toISOString(),
          ],
        );
      }
    }

    await applyAutomaticPickResults(client, seasonYear);

    warningSummary =
      [...rejects.map((r) => r.reason), ...warnings]
        .slice(0, 40)
        .join(" | ")
        .slice(0, 2000) || null;

    if (options.failBeforeSuccessAudit) {
      throw new Error("Injected success-audit failure (test)");
    }

    const runId = await insertSyncRun(client, {
      seasonYear,
      status: "succeeded",
      inserted,
      updated,
      skipped,
      rejected,
      sourceFreshnessAt,
      warningSummary,
    });

    await client.query("COMMIT");

    return {
      runId,
      status: "succeeded",
      inserted,
      updated,
      skipped,
      rejected,
      sourceFreshnessAt,
      errorSummary: null,
      warningSummary,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 2000) : String(error);
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    const runId = await writeFailureAuditBestEffort(client, {
      seasonYear,
      status: "failed",
      rejected,
      sourceFreshnessAt,
      errorSummary: message,
    });
    return {
      runId,
      status: "failed",
      inserted: 0,
      updated: 0,
      skipped: 0,
      rejected,
      sourceFreshnessAt,
      errorSummary: message,
      warningSummary: null,
    };
  }
}
