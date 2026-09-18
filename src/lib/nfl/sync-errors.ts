/**
 * Safe mapping for unexpected NFL sync infrastructure failures.
 * Never return raw TLS, host, URL, SQL, or credential details to the browser.
 */

export const SYNC_DB_CONNECTION_UI_ERROR =
  "NFL sync could not connect to the schedule database. No data was changed.";

export type SyncInfrastructureCategory =
  | "connection"
  | "configuration"
  | "unexpected";

export type SyncInfrastructureClassification = {
  category: SyncInfrastructureCategory;
  code: string;
};

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return "";
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

/** Classify without logging or returning sensitive values. */
export function classifySyncInfrastructureError(
  error: unknown,
): SyncInfrastructureClassification {
  const code = errorCode(error);
  const message = errorMessage(error);

  if (
    code === "SYNC_DB_CONFIG" ||
    /Missing SUPABASE_DB_URL|Invalid schedule database configuration/i.test(
      message,
    )
  ) {
    return { category: "configuration", code: code || "SYNC_DB_CONFIG" };
  }

  const connectionCodes = new Set([
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
    "ECONNRESET",
    "EPIPE",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "CERT_HAS_EXPIRED",
    "ERR_TLS_CERT_ALTNAME_INVALID",
  ]);

  if (
    connectionCodes.has(code) ||
    /self-signed|certificate|SSL|TLS|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|connect E|Connection terminated|password authentication failed|no pg_hba\.conf/i.test(
      message,
    )
  ) {
    return { category: "connection", code: code || "PG_CONNECT_FAILED" };
  }

  return { category: "unexpected", code: code || "SYNC_UNEXPECTED" };
}

/**
 * Server-side log entry: category/code/name only — never URLs or credentials.
 */
export function logSyncInfrastructureError(error: unknown): void {
  const classified = classifySyncInfrastructureError(error);
  console.error("[nfl-sync]", {
    category: classified.category,
    code: classified.code,
    name: errorName(error),
  });
}

/** Browser-safe message for unexpected sync infrastructure failures. */
export function mapSyncInfrastructureErrorForUi(error: unknown): string {
  void error;
  return SYNC_DB_CONNECTION_UI_ERROR;
}
