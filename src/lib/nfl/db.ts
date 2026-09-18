import type pg from "pg";

/**
 * Server-only Postgres client config for NFL schedule sync.
 * Never expose connection strings to the browser, NEXT_PUBLIC_*, logs, or UI.
 */

const CONFLICTING_TLS_QUERY_PARAMS = new Set([
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "uselibpqcompat",
]);

const MISSING_URL_ERROR =
  "Missing SUPABASE_DB_URL (or POSTGRES_URL) for schedule sync.";
const INVALID_URL_ERROR = "Invalid schedule database configuration.";

export type SyncClientSsl =
  | false
  | {
      rejectUnauthorized: false;
    };

export type SyncClientConfig = {
  connectionString: string;
  ssl: SyncClientSsl;
};

/** Resolve the dedicated sync database URL (env order only). */
export function resolveSyncDatabaseUrl(): string {
  return (
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    ""
  );
}

export function isLocalDatabaseHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

/**
 * Build pg.Client options for schedule sync.
 *
 * Strips connection-string TLS params that would overwrite an explicit `ssl`
 * object in pg@8 / pg-connection-string (Object.assign after parse).
 * Non-local hosts always use encrypted TLS with scoped verification disabled
 * for this dedicated Supabase client only.
 */
export function buildSyncClientConfig(
  rawUrl: string = resolveSyncDatabaseUrl(),
): SyncClientConfig {
  if (!rawUrl) {
    throw new Error(MISSING_URL_ERROR);
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    // Never include the supplied value in the error message.
    throw new Error(INVALID_URL_ERROR);
  }

  if (!parsed.hostname) {
    throw new Error(INVALID_URL_ERROR);
  }

  const keysToDelete: string[] = [];
  for (const key of parsed.searchParams.keys()) {
    if (CONFLICTING_TLS_QUERY_PARAMS.has(key.toLowerCase())) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    parsed.searchParams.delete(key);
  }

  const local = isLocalDatabaseHost(parsed.hostname);

  return {
    connectionString: parsed.toString(),
    // Local Postgres often has no TLS; production/non-local must encrypt.
    ssl: local ? false : { rejectUnauthorized: false },
  };
}

export async function withSyncClient<T>(
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const config = buildSyncClientConfig();
  const pgModule = await import("pg");
  const client = new pgModule.default.Client({
    connectionString: config.connectionString,
    ssl: config.ssl,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
