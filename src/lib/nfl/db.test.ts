import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildSyncClientConfig, isLocalDatabaseHost } from "./db.ts";

const SAMPLE_USER = "sync_user";
const SAMPLE_PASS = "s3cret-value-not-for-assert-print";
const SAMPLE_DB = "postgres";

function baseUrl(host: string, query = ""): string {
  const q = query ? `?${query}` : "";
  return `postgresql://${SAMPLE_USER}:${encodeURIComponent(SAMPLE_PASS)}@${host}:5432/${SAMPLE_DB}${q}`;
}

describe("buildSyncClientConfig", () => {
  it("removes sslmode=require", () => {
    const cfg = buildSyncClientConfig(baseUrl("db.example.supabase.co", "sslmode=require"));
    const parsed = new URL(cfg.connectionString);
    assert.equal(parsed.searchParams.has("sslmode"), false);
    assert.deepEqual(cfg.ssl, { rejectUnauthorized: false });
  });

  it("removes sslmode=prefer", () => {
    const cfg = buildSyncClientConfig(baseUrl("db.example.supabase.co", "sslmode=prefer"));
    assert.equal(new URL(cfg.connectionString).searchParams.has("sslmode"), false);
  });

  it("removes sslmode=verify-ca", () => {
    const cfg = buildSyncClientConfig(
      baseUrl("db.example.supabase.co", "sslmode=verify-ca"),
    );
    assert.equal(new URL(cfg.connectionString).searchParams.has("sslmode"), false);
  });

  it("removes uselibpqcompat", () => {
    const cfg = buildSyncClientConfig(
      baseUrl("db.example.supabase.co", "uselibpqcompat=true&sslmode=require"),
    );
    const parsed = new URL(cfg.connectionString);
    assert.equal(parsed.searchParams.has("uselibpqcompat"), false);
    assert.equal(parsed.searchParams.has("sslmode"), false);
  });

  it("removes sslrootcert, sslcert, and sslkey", () => {
    const cfg = buildSyncClientConfig(
      baseUrl(
        "db.example.supabase.co",
        "sslrootcert=/tmp/ca.crt&sslcert=/tmp/client.crt&sslkey=/tmp/client.key&sslmode=require",
      ),
    );
    const parsed = new URL(cfg.connectionString);
    assert.equal(parsed.searchParams.has("sslrootcert"), false);
    assert.equal(parsed.searchParams.has("sslcert"), false);
    assert.equal(parsed.searchParams.has("sslkey"), false);
    assert.equal(parsed.searchParams.has("sslmode"), false);
  });

  it("removes conflicting TLS params case-insensitively", () => {
    const cfg = buildSyncClientConfig(
      baseUrl("db.example.supabase.co", "SSLMode=require&UseLibpqCompat=true"),
    );
    const parsed = new URL(cfg.connectionString);
    for (const key of parsed.searchParams.keys()) {
      assert.equal(
        ["sslmode", "uselibpqcompat"].includes(key.toLowerCase()),
        false,
      );
    }
  });

  it("preserves unrelated query parameters", () => {
    const cfg = buildSyncClientConfig(
      baseUrl(
        "db.example.supabase.co",
        "sslmode=require&application_name=survivor&options=-c%20search_path%3Dpublic",
      ),
    );
    const parsed = new URL(cfg.connectionString);
    assert.equal(parsed.searchParams.get("application_name"), "survivor");
    assert.equal(parsed.searchParams.get("options"), "-c search_path=public");
    assert.equal(parsed.searchParams.has("sslmode"), false);
  });

  it("preserves credentials and database selection without printing them", () => {
    const cfg = buildSyncClientConfig(
      baseUrl("db.example.supabase.co", "sslmode=require"),
    );
    const parsed = new URL(cfg.connectionString);
    assert.equal(parsed.username, SAMPLE_USER);
    assert.equal(parsed.password, SAMPLE_PASS);
    assert.equal(parsed.pathname, `/${SAMPLE_DB}`);
    assert.equal(parsed.hostname, "db.example.supabase.co");
    assert.equal(parsed.port, "5432");
  });

  it("gives non-local hosts scoped rejectUnauthorized=false", () => {
    const cfg = buildSyncClientConfig(baseUrl("db.example.supabase.co"));
    assert.deepEqual(cfg.ssl, { rejectUnauthorized: false });
  });

  it("disables SSL for localhost development", () => {
    const cfg = buildSyncClientConfig(baseUrl("localhost", "sslmode=require"));
    assert.equal(cfg.ssl, false);
    assert.equal(new URL(cfg.connectionString).searchParams.has("sslmode"), false);
  });

  it("disables SSL for 127.0.0.1 development", () => {
    const cfg = buildSyncClientConfig(baseUrl("127.0.0.1"));
    assert.equal(cfg.ssl, false);
  });

  it("disables SSL for ::1 development", () => {
    const cfg = buildSyncClientConfig(
      `postgresql://${SAMPLE_USER}:${encodeURIComponent(SAMPLE_PASS)}@[::1]:5432/${SAMPLE_DB}`,
    );
    assert.equal(isLocalDatabaseHost(new URL(cfg.connectionString).hostname), true);
    assert.equal(cfg.ssl, false);
  });

  it("fails safely when the database URL is missing", () => {
    assert.throws(
      () => buildSyncClientConfig(""),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /Missing SUPABASE_DB_URL/i);
        return true;
      },
    );
  });

  it("fails with a generic error for malformed URLs without echoing the value", () => {
    const bad = "not a url%%%secret-token-should-not-leak";
    assert.throws(
      () => buildSyncClientConfig(bad),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Invalid schedule database configuration.");
        assert.equal(error.message.includes(bad), false);
        assert.equal(error.message.includes("secret-token"), false);
        return true;
      },
    );
  });

  it("never includes secrets in thrown configuration error messages", () => {
    assert.throws(
      () =>
        buildSyncClientConfig(
          `postgresql://${SAMPLE_USER}:${SAMPLE_PASS}@/postgres`,
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.includes(SAMPLE_PASS), false);
        assert.equal(error.message.includes(SAMPLE_USER), false);
        return true;
      },
    );
  });
});
