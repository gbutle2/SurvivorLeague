# Phase 2B-A — Week 1 / Week 2 intended import outcome

**Document only. Do not apply.** No production data, remote migrations, or Auth users are changed by this phase.

## Intended outcome (after a future approved import)

- All six players are active league members
- Week 1 contains the exact picks and results from the approved workbook
- Week 1 is locked/final
- Week 2 is upcoming (or any non-locked/final status) with its real future deadline
- Future weeks are upcoming
- Season is active
- Effective current week is derived as the lowest-numbered week that is not locked/final and whose `locks_at > now()` — so Week 2 becomes current automatically without a stored `open` status
- Week 1 teams count as USED for each applicable player
- Week 1 wins/losses appear in history
- Survivor status reflects Week 1 results (once scoring/survivor presentation reads stored results)

## Required fields that must be supplied (do not invent)

Values must come from the approved workbook and Supabase Auth. Leave blank until known.

### From Supabase Auth

| Field | Source | Notes |
| --- | --- | --- |
| Each player's `auth_user_id` | Supabase Auth → Users | Prefer UUID; do not hardcode in repo |
| Or each player's `email` | Auth + workbook | Admin script may resolve email → UUID |

### From workbook / commissioner records

| Field | Used for |
| --- | --- |
| Display names (6 players) | `profiles.display_name` |
| Commissioner identity | Exactly one `role: commissioner` |
| League name + slug | `leagues` |
| Season year | `seasons.year` |
| Scoring rule integers / flags | `scoring_rules` (must match agreed product rules) |
| Week 1–18 Central Time lock date + time | `weeks.locks_at` via CT conversion |
| Week 1 status (`locked` or `final`) | `weeks.status` |
| Week 2 real deadline (status may stay `upcoming`) | `weeks` |
| Weeks 3–18 status (`upcoming`) + deadlines (strictly increasing) | `weeks` |
| Week 1 pick per player: NFL team abbreviation | `picks.team_id` via `teams.abbreviation` |
| Week 1 pick result per player (`win` / `loss` / `tie`) | `picks.result` |
| Any Week 2 picks (only if workbook already has them) | `picks` — omit if not yet chosen |

### Explicitly not invented here

- Player Auth UUIDs
- Exact Week 1/2 deadline timestamps
- Exact Week 1 team selections or results
- Survivor elimination presentation details beyond stored Week 1 results

When the reviewed JSON is ready, validate with dry-run:

```bash
npm run import:bootstrap -- --file path/to/reviewed-bootstrap.json
```
