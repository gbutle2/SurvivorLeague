/**
 * Fail-closed PostgreSQL query helpers for offline bootstrap import.
 * Never treat a failed query as an empty result set.
 */

import type { QueryResultRow } from "pg";
import type pg from "pg";

export class BootstrapQueryError extends Error {
  readonly causeError: unknown;
  readonly sql: string;

  constructor(message: string, sql: string, causeError: unknown) {
    super(message);
    this.name = "BootstrapQueryError";
    this.sql = sql;
    this.causeError = causeError;
  }
}

type Queryable = Pick<pg.Client, "query">;

function summarizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().slice(0, 120);
}

export async function queryRows<T extends QueryResultRow>(
  client: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } catch (error) {
    throw new BootstrapQueryError(
      `Database query failed (${summarizeSql(sql)}): ${
        error instanceof Error ? error.message : String(error)
      }`,
      sql,
      error,
    );
  }
}

export async function queryMaybeOne<T extends QueryResultRow>(
  client: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await queryRows<T>(client, sql, params);
  if (rows.length > 1) {
    throw new BootstrapQueryError(
      `Database query returned ${rows.length} rows; expected at most one (${summarizeSql(sql)}).`,
      sql,
      null,
    );
  }
  return rows[0] ?? null;
}

export async function queryExactlyOne<T extends QueryResultRow>(
  client: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const row = await queryMaybeOne<T>(client, sql, params);
  if (!row) {
    throw new BootstrapQueryError(
      `Database query returned no row; expected one (${summarizeSql(sql)}).`,
      sql,
      null,
    );
  }
  return row;
}

export async function executeSql(
  client: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<number> {
  try {
    const result = await client.query(sql, params);
    return result.rowCount ?? 0;
  } catch (error) {
    throw new BootstrapQueryError(
      `Database write failed (${summarizeSql(sql)}): ${
        error instanceof Error ? error.message : String(error)
      }`,
      sql,
      error,
    );
  }
}
