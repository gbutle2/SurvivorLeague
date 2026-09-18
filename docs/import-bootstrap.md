# League bootstrap import

Version-controlled, idempotent admin import for league bootstrap data.

## Command

```bash
npm run import:bootstrap -- --file path/to/bootstrap.json
npm run import:bootstrap -- --file path/to/bootstrap.json --apply
npm run import:bootstrap -- --file path/to/bootstrap.json --apply --allow-overwrite
```

Default mode is **dry-run** (plan + counts inside a rolled-back transaction; no writes).

## Credentials (script only)

Required environment variable:

- `SUPABASE_DB_URL` — direct PostgreSQL connection string

Do **not** commit the connection string or database password.
Do **not** use `NEXT_PUBLIC_*` variables.
Do **not** use the service-role key for the apply path.

## Atomic apply

`--apply` runs in one PostgreSQL transaction:

1. `BEGIN ISOLATION LEVEL SERIALIZABLE`
2. Transaction-scoped advisory lock from `league.slug` + `season.year`
3. Resolve Auth users and load snapshot **inside** the transaction
4. Recompute / validate the import plan against that snapshot
5. Perform every planned write inside the same transaction
6. Post-write verification
7. `COMMIT` only if every step succeeds; otherwise `ROLLBACK`

Dry-run uses the same lock + snapshot path and always rolls back.

## Input

Import input is a **reviewed JSON file** generated from the workbook.

- Schema: [`import-bootstrap.schema.json`](./import-bootstrap.schema.json)
- Runtime validation: `src/lib/import/bootstrap-schema.ts`
- Planning / conflict detection: `src/lib/import/bootstrap-plan.ts`
- Transactional apply: `src/lib/import/bootstrap-apply.ts`
- Admin CLI: `scripts/import-bootstrap.ts`

The production Next.js application does **not** parse Excel workbooks.

## Supported entities

- Profiles (Auth UUID must exist; email lookup only via `auth.users` in this admin script)
- League memberships
- Regular-season weeks (status + Central Time deadlines)
- Regular picks and pick results
- Week statuses
- Scoring rules
- Season status

## Safety

- Validates the full document before planning writes
- Dry-run performs no writes
- Conflicting existing rows are refused unless `--allow-overwrite`
- `--allow-overwrite` never bypasses identity, exactly-one-commissioner, week sequence, one-open-week, team reuse, foreign keys, or duplicate-pick restrictions
- Reports inserted / updated / skipped / conflict counts
- On failure after begin: transaction rolled back; zero bootstrap writes committed

## Phase 2B-A

Do **not** run this import against production in this phase.
