# League chat, DMs, activity, and notifications

Feature branch: `feature/league-chat-notifications`  
Migration:
- `supabase/migrations/20260922120000_league_chat_notifications.sql`
- `supabase/migrations/20260922130000_league_chat_idempotency_and_reveal.sql`  
(created, **not** applied to remote)

## Data model

| Table | Purpose |
|-------|---------|
| `conversations` | `league` (one per league) or `direct` (one unordered pair per league) |
| `messages` | User or system messages; soft-delete clears `body`; separate `client_idempotency_key` / `system_idempotency_key` |
| `league_events` | Immutable structured activity; `payload` (public) + `sensitive_payload` (not granted to clients) |
| `conversation_read_states` | Per-member last-read cursor per conversation |
| `notifications` | Recipient-specific in-app alerts |

## Event types

`pick_submitted`, `pick_updated`, `commissioner_pick_changed`, `week_opened`, `week_locked`, `picks_revealed`, `result_entered`, `result_corrected`, `survivor_eliminated`, `season_activated`, `season_deactivated`, `member_added`, `member_removed`, `commissioner_announcement`

Automatic emitters (DB triggers): picks insert/update, weeks status, seasons status, league_members active; reveal via `reveal_eligible_pick_events` (game updates + NFL sync).

## Pick privacy

- Unrevealed events store team ids only in `sensitive_payload` (column not granted to `authenticated`).
- Public `payload` holds week number and safe fields only until reveal.
- When an event is created with `is_revealed = true` (kickoff already passed), team ids are copied into `payload` immediately.
- Formatter (`src/lib/communication/event-format.ts`) never prints team names when `is_revealed = false`.
- Reveal flips `is_revealed` and copies team ids into `payload` when the linked pick satisfies the same rule as pick SELECT visibility.

## Message idempotency

- User messages: `client_idempotency_key`, unique per `(conversation_id, author_user_id, key)`.
- System messages: `system_idempotency_key` in a separate unique namespace.
- Conflict returns only the authenticated sender’s own message in the requested conversation.
- Clients cannot occupy `system_msg:` keys; user messages cannot reference `league_event_id`.

## Reveal execution path (operational)

Wall-clock kickoff does **not** fire a database trigger by itself. Eligible pick activity is revealed by:

1. `public.reveal_eligible_pick_events()` — idempotent, uses `pick_is_revealed_to_peers`
2. Game-row UPDATE trigger calling that function when sync updates games
3. NFL schedule sync (`syncNflSchedule`) calling `reveal_eligible_pick_events()` after grading/week reconciliation

No second independent scheduler.

## Survivor elimination note

Under current product rules and standings logic, a **tie** is treated like a loss for regular-season survivor (not a win; ends the survivor run). Chat `survivor_eliminated` on `loss` or `tie` matches that intentional behavior.

## RLS matrix (summary)

| Resource | Who can read | Who can write |
|----------|--------------|---------------|
| League conversation | Active league members | Message RPCs only |
| DM conversation | The two participants (active members) | Message RPCs only |
| System messages / events | Members (events); no client inserts | Triggers / DEFINER only |
| Notifications | Recipient + still active in league | DEFINER only |
| Commissioner | Same as member for league chat; **cannot** read others’ DMs | No special DM access |

## Badge / unread rules

- Red dot: unread league conversation activity
- Numeric badge: unread DM conversations + unread non-DM alerts (no double-count of DM notifications)
- Opening League / a DM updates that conversation’s read state
- Alerts: mark one or mark all; opening the tab does not auto-read

## Overlay UX

Single floating speech-bubble trigger (not a dashboard card / primary nav item). Mobile bottom sheet ~90vh; desktop right drawer ~400px. Tabs: League, DMs, Alerts. Last tab remembered in `sessionStorage`.

## Realtime

`messages` and `notifications` added to `supabase_realtime`. Client subscribes scoped by `league_id` after authorized initial fetch.

## Deferred

- Mentions (require reliable identity picker)
- Deadline reminder job
- Group DMs, uploads, GIFs, voice, typing, presence, push/email/SMS, threads, public read receipts

## Local testing

```bash
npx supabase start
npx supabase db reset
npm run test:db
node --experimental-strip-types --test "src/lib/communication/*.test.ts"
npm run lint
npm ci && npm run typecheck
npm run build
```

## Rollback

Forward-only. To roll back in a non-production environment: `supabase db reset` to a prior migration set, or add a new migration that drops the communication objects in dependency order (`messages`, `notifications`, `conversation_read_states`, `league_events`, `conversations`, enums, functions). Do not edit this migration after it has been applied anywhere.
