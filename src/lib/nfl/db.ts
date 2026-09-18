import type pg from "pg";

/**
 * Server-only Postgres client for schedule sync.
 * Never expose this connection string to the browser or NEXT_PUBLIC_*.
 */
export function resolveSyncDatabaseUrl(): string {
  const url =
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    "";
  if (!url) {
    throw new Error(
      "Missing SUPABASE_DB_URL (or POSTGRES_URL) for schedule sync.",
    );
  }
  return url;
}

export async function withSyncClient<T>(
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const pgModule = await import("pg");
  const client = new pgModule.default.Client({
    connectionString: resolveSyncDatabaseUrl(),
    ssl: process.env.SUPABASE_DB_SSL === "false" ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}
