# NFL schedule sync (Phase 2B-B)

## Provider

Initial provider: **nflverse** community schedules release

- CSV: `https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv`
- Freshness: `https://github.com/nflverse/nflverse-data/releases/download/schedules/timestamp.json`
- Timezone evidence: [nfldata DATASETS.md](https://github.com/nflverse/nfldata/blob/master/DATASETS.md) documents `gametime` as **Eastern time zone**. The app treats provider wall-clock `gameday` + `gametime` as `America/New_York`, stores UTC `timestamptz`, and displays in `America/Chicago`. Missing or malformed `gametime` rejects the game (never midnight).

This is a community-maintained dataset with **no uptime or live-scoring guarantee**. Do not claim live scoring while using nflverse.

The app uses a **fixed server-side URL**. Request parameters cannot supply an arbitrary provider URL.

## Provider limitations (truthful)

- Kickoff changes are synchronized **before** the stored kickoff; post-kickoff schedule changes require commissioner review (`schedule_review_items`).
- Scores are refreshed by the daily Hobby cron plus commissioner manual sync — **not live scoring**.
- The CSV does **not** reliably provide live in-progress state and may not explicitly represent cancellations/postponements/no-contests. Those may require commissioner action (`games.manual_override` and/or review items).
- Final status is derived when both scores are present; the parser does not invent `in_progress`, `postponed`, or `canceled` from absent fields.

## Validated fields

Required CSV columns: `game_id`, `season`, `game_type`, `week`, `gameday`, `gametime`, `away_team`, `home_team`, `away_score`, `home_score`.

Mapped:

- `REG` weeks 1–18 → regular season
- `WC` / `DIV` / `CON` / `SB` → playoff rounds
- Team abbreviations (including `LA` → `LAR`)
- Kickoff = Eastern wall clock (`America/New_York`) from `gameday` + `gametime` → UTC storage → Central display
- Final when both scores present; ties leave `winner_team_id` null

## Sync behavior

1. Fetch CSV + timestamp with timeout and size limits (**outside** any DB transaction)
2. Validate schema / duplicates / teams / timestamps
3. Open one dedicated `pg.Client` transaction + advisory lock (overlapping syncs rejected)
4. Reload DB state under the lock; upsert by `(provider, provider_game_id)`
5. Ensure league weeks 1–18 and playoff rounds
6. Apply automatic results to **pending** picks with `result_source = auto` only
7. Insert successful `schedule_sync_runs` audit **inside the same transaction**, then COMMIT

Never partially applies: validation failures make no schedule changes; success-audit failure rolls back all schedule/result writes. Failure/rejection audits may be written afterward in a separate best-effort transaction and never claim rolled-back data succeeded.

`syncNflSchedule` rejects `pg.Pool` (mixed connections) and requires a dedicated client.

## Dedicated Postgres TLS (sync client only)

Vercel/Supabase `POSTGRES_URL*` values often include libpq-style TLS query parameters (`sslmode`, etc.). In `pg` 8.x, those parameters are parsed after the Client config and **replace** an explicit `ssl` object, which can force verify-full behavior and fail against the managed database certificate chain.

The schedule sync client therefore:

1. Resolves `SUPABASE_DB_URL` → `POSTGRES_URL_NON_POOLING` → `POSTGRES_URL`
2. Removes conflicting URL TLS parameters (`sslmode`, `sslrootcert`, `sslcert`, `sslkey`, `uselibpqcompat`)
3. Uses **encrypted TLS** for every non-local host with scoped `rejectUnauthorized: false` on this dedicated server-only `pg.Client` only
4. Disables SSL only for local development hosts (`localhost` / `127.0.0.1` / `::1`)

This is **not** full certificate verification. Global Node TLS verification and NFLverse HTTPS verification remain enabled. `NODE_TLS_REJECT_UNAUTHORIZED=0` is prohibited. A future hardening step is to trust the Supabase CA and set `rejectUnauthorized: true` without conflicting URL `sslmode` parameters.

Connection strings must never be logged, returned to the browser, or placed in `NEXT_PUBLIC_*` variables.

## Manual override rule

`games.manual_override = true` freezes **all** provider-managed schedule and result fields on that game. Subsequent syncs only advance `last_synced_at`. Commissioner-corrected pick results use `result_source = commissioner` with a nonblank `result_override_reason` and are never overwritten by automatic sync.

## Freshness expectations

- Vercel **Hobby** plan: at most **one cron job per day** (`vercel.json` → `/api/cron/nfl-sync` at `0 14 * * *`)
- Auth: `Authorization: Bearer <SCHEDULE_SYNC_SECRET|CRON_SECRET>`
- Commissioner **Sync NFL data** is the manual fallback
- UI shows last successful sync; stale (>36h) warning on pick page

## Kickoff locking

- Picks lock at the **selected team’s** `scheduled_kickoff_at` (`>` required; equality locked)
- Cannot switch away from a kicked-off selection (USING clause)
- Cannot switch onto a kicked-off team (WITH CHECK)
- Bye teams are not selectable
- `weeks.locks_at` is informational (earliest kickoff), not pick authority

## Schedule-change safeguards

- Before kickoff: automatic kickoff updates apply
- After stored kickoff: automatic sync **cannot** move kickoff; change is queued in `schedule_review_items`
- Canceled/no-contest signals (when present): flagged for commissioner; no automatic win/loss invention

## Results and pick provenance

- Final game → pending auto picks become win / loss / tie (tie = incorrect)
- `game_id` is derived in PostgreSQL from the selected team and week/round
- Players cannot set `result_source` or `result_override_reason`
- Commissioner corrections set `result_source = commissioner` with a nonblank reason and are not overwritten by later sync
- Regular survivor: eliminated players continue weekly picks for record/streak
- Playoffs: only a prior pick with `result = 'win'` advances after that prior round is fully final; pending/loss/tie/missed/unfinished prior rounds block

## Team appearance invariant

`game_participants` enforces one non-canceled appearance per team per regular week or playoff round (home or away). Canceled games release participant rows so a replacement game may be inserted.

## Import order (revised)

1. Auth users exist
2. NFL schedule sync populates games + weeks
3. Bootstrap imports membership, scoring rules, historical Week 1 picks
4. Activate season after schedule + membership verification

Manual 18-week deadline JSON is no longer required for routine season operation.

## Replacing the provider later

Keep `games.provider` / `provider_game_id`, swap the fixed URL + parser module, and retain the same upsert/lock/result semantics. Do not add another provider in this phase.
