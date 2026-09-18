# Commissioner setup

Auth users are created in Supabase Auth (not seeded in SQL) because UUIDs come from Auth.

## 1. Create the commissioner Auth user

In the Supabase Dashboard:

1. Open **Authentication → Users**
2. Click **Add user** → **Create new user**
3. Enter the commissioner email and a temporary password
4. Optionally set user metadata: `{ "display_name": "Your Name" }`
5. Copy the new user's UUID

A `profiles` row is created automatically by the `on_auth_user_created` trigger.

## 2. Create the league and membership (SQL editor)

Run as a privileged role in the Supabase SQL editor (bypasses RLS for bootstrap):

```sql
-- Replace these values
-- :commissioner_id = UUID from Auth
-- Adjust name/slug/timezone as needed

INSERT INTO public.leagues (name, slug, timezone, commissioner_user_id)
VALUES (
  'Sunday Survivor',
  'sunday-survivor',
  'America/Chicago',
  '00000000-0000-0000-0000-000000000000' -- commissioner UUID
)
RETURNING id;

-- Then insert membership (use the league id returned above)
INSERT INTO public.league_members (league_id, user_id, role, active)
VALUES (
  '00000000-0000-0000-0000-000000000000', -- league id
  '00000000-0000-0000-0000-000000000000', -- commissioner UUID
  'commissioner',
  true
);
```

## 3. Invite players

1. Create each player in **Authentication → Users** (or invite by email if enabled)
2. Confirm their `profiles` row exists
3. As commissioner (or via SQL), insert `league_members` with `role = 'player'`

Do not enable public sign-up in Supabase Auth for this app. Keep **Enable email signup** disabled (or equivalent) so only invited users can authenticate.

## 4. Optional season bootstrap

```sql
INSERT INTO public.seasons (league_id, year, status)
VALUES ('<league-id>', 2026, 'setup')
RETURNING id;

INSERT INTO public.scoring_rules (season_id)
VALUES ('<season-id>');
```

## 5. Season calendar (Phase 2B)

Do not create weeks one-by-one for a normal season.

1. Activate scoring rules + season when ready
2. On **Commissioner**, use **Configure season calendar** with all 17 Central Time deadlines as JSON
3. Open the current week when players should pick; lock when the deadline passes

Single-week create remains only under **Exceptional: create a single week manually**.

See also:

- [`commissioner-member-management.md`](./commissioner-member-management.md) — in-app player account creation with temporary passwords
- [`import-bootstrap.md`](./import-bootstrap.md) — admin bootstrap import (not run in Phase 2B-A)
- [`phase2b-week1-week2-target.md`](./phase2b-week1-week2-target.md) — documented Week 1/2 target fields
