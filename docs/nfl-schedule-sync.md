# NFL schedule sync (Phase 2B-B)

## Provider

Initial provider: **nflverse** community schedules release

- CSV: `https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv`
- Freshness: `https://github.com/nflverse/nflverse-data/releases/download/schedules/timestamp.json`

This is a community-maintained dataset with **no uptime or live-scoring guarantee**. Do not claim live scoring while using nflverse.

The app uses a **fixed server-side URL**. Request parameters cannot supply an arbitrary provider URL.

## Validated fields

Required CSV columns: `game_id`, `season`, `game_type`, `week`, `gameday`, `gametime`, `away_team`, `home_team`, `away_score`, `home_score`.

Mapped:

- `REG` weeks 1–18 → regular season
- `WC` / `DIV` / `CON` / `SB` → playoff rounds
- Team abbreviations (including `LA` → `LAR`)
- Kickoff = Central Time wall clock from `gameday` + `gametime`
- Final when both scores present; ties leave `winner_team_id` null

## Sync behavior

1. Fetch CSV + timestamp with timeout and size limits
2. Validate schema / duplicates / teams / timestamps
3. Transaction + advisory lock (overlapping syncs rejected)
4. Upsert by `(provider, provider_game_id)`
5. Ensure league weeks 1–18 and playoff rounds
6. Apply automatic results to **pending** picks with `result_source = auto`
7. Record `schedule_sync_runs` audit row

Never partially applies: validation/application failures roll back game writes.

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

- Before kickoff: automatic kickoff updates (including postponements) apply
- After stored kickoff: automatic sync **cannot** move kickoff forward or reopen picks; change is queued in `schedule_review_items`
- Manual override (`games.manual_override`): preserved; kickoff not silently rewritten
- Canceled games: flagged for commissioner; no automatic win/loss

## Results

- Final game → pending auto picks become win / loss / tie (tie = incorrect)
- Commissioner corrections set `result_source = commissioner` and are not overwritten by later sync
- Regular survivor: eliminated players continue weekly picks for record/streak
- Playoffs: loss/tie/missed completed round blocks later rounds; separate reuse pool

## Import order (revised)

1. Auth users exist
2. NFL schedule sync populates games + weeks
3. Bootstrap imports membership, scoring rules, historical Week 1 picks
4. Activate season after schedule + membership verification

Manual 18-week deadline JSON is no longer required.

## Replacing the provider later

Keep `games.provider` / `provider_game_id`, swap the fixed URL + parser module, and retain the same upsert/lock/result semantics.
