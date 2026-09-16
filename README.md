# Sunday Survivor Picks

Private NFL survivor-league app (Phase 1 foundation).

Stack: Next.js App Router, TypeScript, Tailwind CSS, Supabase (Auth + PostgreSQL), Vercel.

## Local setup

1. Clone the repo and install dependencies:

```bash
npm install
```

2. Copy environment variables:

```bash
cp .env.example .env.local
```

3. Fill in values from your Supabase project (**Project Settings → API**):

| Variable | Description |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon / public key |

Never put the **service role** key in `NEXT_PUBLIC_*` variables or commit it.

4. Create a Supabase project and apply migrations (below).

5. Create the first commissioner (see [docs/commissioner-setup.md](docs/commissioner-setup.md)).

## Applying Supabase migrations

Migrations live in `supabase/migrations/` and run in filename order:

1. `20260916120000_schema.sql` — tables, enums, profile trigger
2. `20260916120100_security_helpers.sql` — SECURITY DEFINER helpers + pick constraints
3. `20260916120200_rls.sql` — Row Level Security policies
4. `20260916120300_seed_nfl_teams.sql` — all 32 NFL teams

### Option A: Supabase CLI

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

### Option B: SQL editor

In the Supabase Dashboard SQL editor, run each migration file in order.

## Creating the first commissioner

Auth users are **not** seeded in SQL. Follow [docs/commissioner-setup.md](docs/commissioner-setup.md):

1. Create the user in Supabase Auth
2. Insert the league + `league_members` row as commissioner via SQL
3. Invite players the same way (Auth user + membership)

Keep public registration disabled.

## Running locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Unauthenticated visitors are redirected to `/login`.

## Type checking

```bash
npm run typecheck
```

## Lint

```bash
npm run lint
```

## Production build

```bash
npm run build
```

## Deploying on Vercel

1. Import `gbutle2/SurvivorLeague` into Vercel
2. Set environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
3. Deploy the `main` branch
4. In Supabase Auth → URL configuration, add your Vercel URL to redirect allow-list / site URL

Do not connect a custom domain until Phase 1 is verified.

## Phase 1 scope

Included:

- Email/password sign-in (no public registration UI)
- Protected session handling via `@supabase/ssr`
- Versioned schema + RLS
- NFL team seed
- Authenticated mobile-first home shell with placeholder sections

Not included yet:

- Pick entry workflow / scoring UI
- NFL scores API
- Payments, email infrastructure, analytics
