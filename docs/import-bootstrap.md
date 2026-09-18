# League bootstrap import

Version-controlled, idempotent admin import for league bootstrap data.

## Command

```bash
npm run import:bootstrap -- --file path/to/bootstrap.json
npm run import:bootstrap -- --file path/to/bootstrap.json --apply
npm run import:bootstrap -- --file path/to/bootstrap.json --apply --allow-overwrite
```

Default mode is **dry-run** (plan + counts, no writes).

## Credentials (script only)

Required environment variables for the admin script:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Do **not** put the service-role key in the Next.js app, `.env.local` committed files, or any `NEXT_PUBLIC_*` variable. Do not commit credentials or production Auth UUIDs.

## Input

Import input is a **reviewed JSON file** generated from the workbook.

- Schema: [`import-bootstrap.schema.json`](./import-bootstrap.schema.json)
- Runtime validation: `src/lib/import/bootstrap-schema.ts`
- Planning / conflict detection: `src/lib/import/bootstrap-plan.ts`
- Admin CLI: `scripts/import-bootstrap.ts`

The production Next.js application does **not** parse Excel workbooks.

## Supported entities

- Profiles (Auth UUID required to exist; email lookup only in this admin script)
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
- Reports inserted / updated / skipped / conflict counts
- Apply stops on the first write failure (remaining steps are not attempted)

## Phase 2B-A

Do **not** run this import against production in this phase.
