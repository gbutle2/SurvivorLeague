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
- Enforce security in the server and database; never rely on UI-only controls.
- Scoring must be centralized and deterministic when implemented.
- UI must be mobile-first and accessible.
- Before completion: lint, clean typecheck (`npm ci` then `npm run typecheck`, which runs `next typegen` before `tsc`), focused tests that exist, and production build.
- Handoffs must truthfully list checks actually run and migrations created versus applied.

## Agreed product rules

- 18 regular-season weekly picks
- One NFL team per player per week
- Selected team must play that NFL week; pick locks at that team’s kickoff
- No regular-season team reuse
- Eliminated players continue making weekly picks
- Win = 1 point; loss or tie = 0
- Missed pick is not a win, breaks streak, and eliminates from regular survivor
- Best record = 4 bonus points
- Longest streak = 4 bonus points
- Regular survivor winner = 10 bonus points
- Tied category leaders each receive the full bonus
- One 18-0 player automatically wins overall
- Multiple 18-0 players use the playoff survivor as the tiebreak
- Playoffs are a separate survivor with a fresh used-team list
- Playoff points are 2 / 4 / 6 / 12 (maximum 24)
- Central Time
- Other players’ picks remain hidden until the relevant kickoff/deadline
- Undefined cases such as cancellations, postponements, and exhausted playoff tiebreaks must not be guessed

## Environment

Use only:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Never introduce a service-role / secret key into the Next.js app or `NEXT_PUBLIC_*` variables.
