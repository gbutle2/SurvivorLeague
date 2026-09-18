<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Sunday Survivor Picks — agent guide

## Working agreements

- Inspect the repository before editing.
- Prefer the smallest coherent change that satisfies the request.
- Do not invent requirements, seed data, setup steps, or test results.
- Ask when an undefined decision affects scoring, security, or stored data.
- Do not add unrelated features, services, abstractions, dependencies, or refactors.
- Do not apply remote migrations, deploy, change production data, or connect custom domains without explicit approval.
- Never edit an already-applied Supabase migration. Fix defects with a new forward-only migration. Before changing an existing migration file, compare its version with the remote migration list; local `db reset` success does not prove the production upgrade path. Production preflight must compare expected functions/triggers/policies with `pg_catalog`.
- Enforce security in the server and database; never rely on UI-only controls.
- Scoring must be centralized and deterministic when implemented.
- UI must be mobile-first and accessible.
- Before completion: lint, clean typecheck (`npm ci` then `npm run typecheck`, which runs `next typegen` before `tsc`), focused tests that exist, and production build.
- Handoffs must truthfully list checks actually run and migrations created versus applied.

## Agreed product rules

- 17 regular-season weekly picks
- One NFL team per player per week
- Selected team must play that NFL week; pick locks at that team’s kickoff
- No regular-season team reuse
- Eliminated players continue making weekly picks for points
- Win = 1 point; loss or tie = 0
- Missed pick is not a win, breaks streak, and eliminates from regular survivor
- Best record = 3 bonus points
- Longest streak = 3 bonus points
- Regular survivor winner = 5 bonus points
- Tied category leaders each receive the full bonus
- Regular survivor ends as soon as exactly one player remains alive; that player keeps the bonus even if they later lose
- If every remaining survivor is eliminated in the same week, those players tie and each receives the full survivor bonus
- If multiple players remain alive through the final regular-season week, they tie and each receives the full survivor bonus
- One 17-0 player automatically wins overall
- Multiple 17-0 players use the playoff survivor as the tiebreak
- Playoffs are a separate survivor with a fresh used-team list
- Playoff points are 1 / 2 / 3 / 4 (maximum 10)
- A missed pick in a completed playoff round eliminates that player from playoff survivor
- Central Time
- Other players’ picks remain hidden until the relevant kickoff/deadline
- Undefined cases such as cancellations, postponements, and exhausted playoff tiebreaks must not be guessed

## Environment

Browser-accessible variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Approved server-only schedule-sync variables:

- `SUPABASE_DB_URL`, `POSTGRES_URL_NON_POOLING`, or `POSTGRES_URL`
- `CRON_SECRET` or `SCHEDULE_SYNC_SECRET`

Approved server-only Auth administration variable (commissioner member management):

- `SUPABASE_SERVICE_ROLE_KEY`

Security requirements:

- Database URLs, passwords, service-role keys, secret keys, and cron secrets must never use a `NEXT_PUBLIC_` prefix.
- Server-only database connections may be used only in server code running in the Node.js runtime.
- The browser Supabase client must use only the project URL and publishable key.
- Never expose database URLs or secret/service-role credentials to client components, browser bundles, logs, API responses, or source control.
- Use `SUPABASE_SERVICE_ROLE_KEY` only from `server-only` Auth Admin modules after cookie-session commissioner authorization — never as a substitute for requester checks, and never when a direct server-only PostgreSQL connection is sufficient for non-Auth work.
- `.env.local` and Vercel secret values must remain untracked.
