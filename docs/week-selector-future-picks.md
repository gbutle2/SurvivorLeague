# Week selector and future picks

Feature branch: `feature/week-selector-future-picks`  
Migrations (local only until release):

- `supabase/migrations/20260922150000_week_selector_future_picks.sql`
- `supabase/migrations/20260922160000_week_pick_submission_status.sql` (forward correction)
- `supabase/migrations/20260922170000_commissioner_override_provenance.sql` (durable override stamp)
- `supabase/migrations/20260922180000_clear_override_stamp_on_selection_change.sql` (clear stamp on any selection change)

## Authority rules

| Concern | Authority |
|---------|-----------|
| Which week is the UI default | Schedule-derived `effective_current_week_id` (earliest week with a future kickoff) |
| Whether a player may mutate a pick for a week | `week_allows_player_picks`: active season and week status **not** `locked`/`final` |
| Whether a specific team may be chosen or kept | Per-team kickoff via `pick_team_plays_unlocked_in_week` (`scheduled`/`postponed` and `scheduled_kickoff_at > now()`) |
| Whether an existing pick may still be changed | Selected team's game still unlocked; UI locks the whole form via `isExistingPickLocked` |
| Peer submission status (without team) | `week_pick_submission_status(week_id)` — `user_id`, `has_pick`, `currently_commissioner_overridden` |
| Commissioner override indicator | `picks.last_commissioner_override_audit_id` matches a non-cleared audit whose team/game still equal the pick; any `team_id`/`game_id` change clears the stamp (any session) |
| Commissioner `open` status / one-open index | Administrative only — does **not** gate player picks |
| Peer pick visibility | Unchanged: own row, or kickoff has started on the pick’s `game_id` |

`upcoming` weeks with schedule data are pickable in advance. Manually `locked` or reconciled `final` weeks remain read-only for players.

## Week selector

- URL: `?week=N` on `/` and `/pick`
- Options: every regular-season week with schedule data (or locked/final status)
- Labels: `Week N — Final | In progress | Upcoming | Locked`
- Default: effective current week → else earliest future kickoff → else latest completed

## Cumulative standings

Standings use `buildRegularStandings(..., { throughWeekNumber, awardSeasonBonuses, includePlayoffs })`.

Cutoff = latest **final** week at or before the selected week (after schedule terminal signals). Mid-season cutoffs do not award season-level best-record / longest-streak bonuses or playoff points.

## Team reuse

Season-unique team reservation includes future picks. Changing a future pick before kickoff releases the old team. Advisory locks unchanged.

## Chat

Pick submit/update still emits privacy-safe league events. Changing the week dropdown does not create events.
