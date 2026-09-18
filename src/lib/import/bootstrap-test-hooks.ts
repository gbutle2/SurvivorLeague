/**
 * Test-only failure injection for bootstrap import integration tests.
 *
 * Cannot be enabled accidentally in production:
 * - BOOTSTRAP_IMPORT_TEST_MODE must be exactly "1"
 * - BOOTSTRAP_IMPORT_ALLOW_TEST_HOOKS must be exactly "1"
 * - Database host must be localhost / 127.0.0.1
 * - CLI never enables hooks unless those gates pass
 *
 * Keep this module out of browser / Next.js application routes.
 */

export type BootstrapTestFailAfter =
  | "profiles"
  | "memberships"
  | "weeks"
  | "corrupt_week_deadline"
  | "verify";

const ALLOWED = new Set<string>([
  "profiles",
  "memberships",
  "weeks",
  "corrupt_week_deadline",
  "verify",
]);

export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  try {
    const parsed = new URL(databaseUrl);
    return (
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "localhost" ||
      parsed.hostname === "::1"
    );
  } catch {
    return false;
  }
}

export function readBootstrapTestFailAfter(options: {
  databaseUrl: string;
  env?: NodeJS.ProcessEnv;
}): BootstrapTestFailAfter | null {
  const env = options.env ?? process.env;
  if (env.BOOTSTRAP_IMPORT_TEST_MODE !== "1") {
    return null;
  }
  if (env.BOOTSTRAP_IMPORT_ALLOW_TEST_HOOKS !== "1") {
    return null;
  }
  if (!isLocalDatabaseUrl(options.databaseUrl)) {
    throw new Error(
      "Bootstrap test hooks refused: database host is not localhost.",
    );
  }
  const raw = env.BOOTSTRAP_IMPORT_TEST_FAIL_AFTER?.trim() ?? "";
  if (!raw) {
    return null;
  }
  if (!ALLOWED.has(raw)) {
    throw new Error(
      `Invalid BOOTSTRAP_IMPORT_TEST_FAIL_AFTER="${raw}". Allowed: ${[...ALLOWED].join(", ")}`,
    );
  }
  return raw as BootstrapTestFailAfter;
}

export function assertTestHookOrThrow(
  failAfter: BootstrapTestFailAfter,
): never {
  throw new Error(
    `BOOTSTRAP_IMPORT_TEST_FAIL_AFTER=${failAfter} (intentional test rollback)`,
  );
}
