#!/usr/bin/env node
/**
 * Admin-only league bootstrap import (offline).
 *
 * Apply path uses a direct PostgreSQL connection (SUPABASE_DB_URL) inside one
 * SERIALIZABLE transaction with a transaction-scoped advisory lock.
 * Never commit connection strings or passwords. Never use NEXT_PUBLIC_* vars.
 * Do not use the service-role key for apply.
 *
 * Default: --dry-run (write-free). Use --apply only after explicit approval.
 *
 * Usage:
 *   npm run import:bootstrap -- --file path/to/bootstrap.json
 *   npm run import:bootstrap -- --file path/to/bootstrap.json --apply
 *   npm run import:bootstrap -- --file path/to/bootstrap.json --apply --allow-overwrite
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  applyBootstrapTransaction,
  dryRunBootstrapTransaction,
} from "../src/lib/import/bootstrap-apply.ts";
import { validateBootstrapDocument } from "../src/lib/import/bootstrap-schema.ts";

function parseArgs(argv: string[]) {
  let file: string | null = null;
  let apply = false;
  let allowOverwrite = false;
  let dryRun = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--file") {
      file = argv[i + 1] ?? null;
      i += 1;
    } else if (arg === "--apply") {
      apply = true;
      dryRun = false;
    } else if (arg === "--dry-run") {
      dryRun = true;
      apply = false;
    } else if (arg === "--allow-overwrite") {
      allowOverwrite = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return { file, apply, allowOverwrite, dryRun };
}

function printHelp() {
  console.log(`League bootstrap import (admin script)

Required env:
  SUPABASE_DB_URL   Direct Postgres URL (never commit; never NEXT_PUBLIC_*)

Options:
  --file <path>          Reviewed JSON import document
  --dry-run              Plan only inside a rolled-back transaction (default)
  --apply                Atomic SERIALIZABLE apply (all-or-nothing)
  --allow-overwrite      Update conflicting rows after explicit review
                         (does not bypass identity, one-open-week, team reuse,
                          week sequence, FKs, or duplicate-pick constraints)
`);
}

function requireDbUrl(): string {
  const value = process.env.SUPABASE_DB_URL?.trim();
  if (!value) {
    throw new Error(
      "SUPABASE_DB_URL is required for bootstrap import (direct Postgres).",
    );
  }
  if (value.includes("NEXT_PUBLIC")) {
    throw new Error("Refusing NEXT_PUBLIC-derived database URL.");
  }
  return value;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    printHelp();
    process.exit(1);
  }

  const databaseUrl = requireDbUrl();
  const filePath = resolve(process.cwd(), args.file);
  const raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  const validated = validateBootstrapDocument(raw);
  if (!validated.ok) {
    console.error(`Validation failed: ${validated.error}`);
    process.exit(1);
  }

  if (args.dryRun || !args.apply) {
    const result = await dryRunBootstrapTransaction({
      databaseUrl,
      document: validated.document,
      allowOverwrite: args.allowOverwrite,
    });
    if (!result.ok) {
      console.error(`Dry-run failed: ${result.error}`);
      if (result.conflicts) {
        for (const conflict of result.conflicts) {
          console.error(
            `  - [${conflict.entity}] ${conflict.key}: ${conflict.message}`,
          );
        }
      }
      if (result.rolledBack) {
        console.error("Transaction rolled back. Zero bootstrap writes committed.");
      }
      process.exit(1);
    }
    console.log(result.report);
    console.log(
      "Dry-run complete. Transaction rolled back. Zero bootstrap writes committed.",
    );
    process.exit(0);
  }

  const result = await applyBootstrapTransaction({
    databaseUrl,
    document: validated.document,
    allowOverwrite: args.allowOverwrite,
  });

  if (!result.ok) {
    console.error(`Apply failed: ${result.error}`);
    if (result.conflicts) {
      for (const conflict of result.conflicts) {
        console.error(
          `  - [${conflict.entity}] ${conflict.key}: ${conflict.message}`,
        );
      }
    }
    if (result.rolledBack) {
      console.error("Transaction rolled back. Zero bootstrap writes committed.");
    } else {
      console.error(
        "Apply failed before a verified rollback could be confirmed.",
      );
    }
    process.exit(1);
  }

  console.log(result.report);
  console.log(
    `Apply committed. inserted=${result.counts.inserted} updated=${result.counts.updated} skipped=${result.counts.skipped}`,
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
