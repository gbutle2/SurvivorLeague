# Commissioner member management

## Purpose

The league commissioner creates and manages player accounts from `/commissioner/members` using temporary passwords. Public registration, email invitations, SMTP, and OAuth are not used.

## Required environment

Browser-safe:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

Server-only (never `NEXT_PUBLIC_`):

- `SUPABASE_SERVICE_ROLE_KEY` — required for Auth Admin (`createUser`, `updateUserById`, `getUserById`, compensation `deleteUser`)

Auth user creation and `app_metadata` updates cannot be done with the publishable key. The service-role client lives in `src/lib/supabase/admin.ts` (`server-only`), disables session persistence, and is never imported by Client Components.

Service-role use **never** replaces requester authorization: every Admin call is preceded by cookie-session auth proving an **active commissioner** of the current league.

## Temporary-password lifecycle

1. Commissioner creates a player and enters a temporary password (confirmed twice) that meets policy: ≥20 characters with uppercase, lowercase, a number, and a symbol. Server-side validation rejects mismatches and policy failures before Auth user creation.
2. Auth user is created with that password, `email_confirm: true`, `app_metadata.must_change_password = true`, and role `player`. The password is never stored in Postgres, metadata, logs, or URLs.
3. The temporary password is shown **once** in the commissioner UI (copy + dismiss) so it can be shared out of band.
4. Player signs in → middleware forces `/change-password`.
5. Player sets a new password via their session; Admin clears `must_change_password` to `false`.
6. Player is signed out and must sign in with the new password.

Absent `must_change_password` means false (existing commissioner accounts).

Players cannot clear the flag with the browser Supabase client (`app_metadata` is Admin-only).

Resetting an existing player’s temporary password still uses a cryptographically generated password (not commissioner-entered).

## Deactivation versus deletion

- **Deactivate** sets `league_members.active = false`. Auth user, profile, and picks remain.
- Accounts are **not** deleted from this UI.
- Inactive members are denied league access by existing RLS (`is_active_league_member`).
- Commissioners cannot deactivate themselves or other commissioners here.
- Reactivation does not reset passwords.

## Conflicts

- Duplicate Auth emails return a safe conflict (no silent attach of a pre-existing user).
- Duplicate league membership for the same user is rejected.
- Role is always `player` for created accounts; no self-promotion via this UI.
- There is no fixed active-member capacity limit.

## Local testing

1. Set `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` (local Supabase or project key).
2. Sign in as an active commissioner.
3. Open `/commissioner/members`, create a player with a compliant temporary password (and confirmation), then copy the one-time display if needed.
4. Sign out, sign in as the player, complete `/change-password`.
5. Confirm the player can reach the home page and that `must_change_password` is cleared.

## Security boundaries

- Submitted `league_id`, `requester_id`, and `role` form fields are ignored.
- Email/app metadata lookups use Admin API only for user IDs already in the commissioner’s league.
- Unexpected errors are mapped to safe UI strings; logs use category/code only.
- UI visibility is not security — RLS and server checks remain authoritative.

## Known limitations

- **Session revocation after password reset:** this Supabase Admin SDK’s `signOut` requires a user JWT. Existing sessions are not force-revoked on temporary-password reset; the player must use the new password on next authentication.
- **Account recovery:** no email reset flow in this release. The commissioner issues a new temporary password.
- **Email invitations / SMTP:** future work.

## Cross-system compensation

Auth and Postgres are not one transaction. If membership/profile setup fails after a **newly created** Auth user:

1. Remove partial membership rows for that user/league.
2. `deleteUser` only for that newly created Auth id (cascades profile).
3. Never delete a pre-existing Auth user.
