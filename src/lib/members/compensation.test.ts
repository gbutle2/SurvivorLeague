import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { shouldDeleteAuthUserOnCompensation } from "./policy.ts";
import { compensateFailedPlayerSetup } from "./membership-mutations.ts";
import { logMemberError } from "./validation.ts";

describe("partial-failure compensation behavior", () => {
  const originalError = console.error;
  const logs: unknown[] = [];

  afterEach(() => {
    console.error = originalError;
    logs.length = 0;
  });

  function captureLogs() {
    console.error = (...args: unknown[]) => {
      logs.push(args);
    };
  }

  it("never deletes a pre-existing Auth user", () => {
    assert.equal(
      shouldDeleteAuthUserOnCompensation({
        newlyCreatedInThisRequest: false,
        preExistingUser: true,
      }),
      false,
    );
  });

  it("deletes only a user created in the failed request", () => {
    assert.equal(
      shouldDeleteAuthUserOnCompensation({
        newlyCreatedInThisRequest: true,
        preExistingUser: false,
      }),
      true,
    );
  });

  it("membership delete succeeds and new Auth user is deleted", async () => {
    captureLogs();
    let deletedAuth = false;
    await compensateFailedPlayerSetup(
      {
        from: () => ({
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        }),
        auth: {
          admin: {
            deleteUser: async () => {
              deletedAuth = true;
              return { error: null };
            },
          },
        },
      },
      { leagueId: "league-1", userId: "new-user", deleteAuthUser: true },
    );
    assert.equal(deletedAuth, true);
    assert.equal(logs.length, 0);
  });

  it("membership delete returns an error and Auth deletion is still attempted", async () => {
    captureLogs();
    let deletedAuth = false;
    await compensateFailedPlayerSetup(
      {
        from: () => ({
          delete: () => ({
            eq: () => ({
              eq: async () => ({
                error: {
                  message: "permission denied for table league_members SECRET",
                  code: "42501",
                },
              }),
            }),
          }),
        }),
        auth: {
          admin: {
            deleteUser: async () => {
              deletedAuth = true;
              return { error: null };
            },
          },
        },
      },
      { leagueId: "league-1", userId: "new-user", deleteAuthUser: true },
    );
    assert.equal(deletedAuth, true);
    assert.equal(logs.length, 1);
    const payload = JSON.stringify(logs[0]);
    assert.match(payload, /MEMBERSHIP_CLEANUP_FAILED/);
    assert.equal(payload.includes("SECRET"), false);
    assert.equal(payload.includes("permission denied"), false);
  });

  it("Auth deletion returns an error safely", async () => {
    captureLogs();
    await compensateFailedPlayerSetup(
      {
        from: () => ({
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        }),
        auth: {
          admin: {
            deleteUser: async () => ({
              error: { message: "service_role key leaked TEMP_PASSWORD_xyz" },
            }),
          },
        },
      },
      { leagueId: "league-1", userId: "new-user", deleteAuthUser: true },
    );
    assert.equal(logs.length, 1);
    const payload = JSON.stringify(logs[0]);
    assert.match(payload, /AUTH_DELETE_FAILED/);
    assert.equal(payload.includes("service_role"), false);
    assert.equal(payload.includes("TEMP_PASSWORD"), false);
  });

  it("pre-existing Auth user is never deleted", async () => {
    let deletedAuth = false;
    await compensateFailedPlayerSetup(
      {
        from: () => ({
          delete: () => ({
            eq: () => ({
              eq: async () => ({ error: null }),
            }),
          }),
        }),
        auth: {
          admin: {
            deleteUser: async () => {
              deletedAuth = true;
              return { error: null };
            },
          },
        },
      },
      { leagueId: "league-1", userId: "existing-user", deleteAuthUser: false },
    );
    assert.equal(deletedAuth, false);
  });

  it("logMemberError never receives secret or error text", () => {
    captureLogs();
    logMemberError("compensation", "MEMBERSHIP_CLEANUP_FAILED");
    assert.deepEqual(logs[0], [
      "[member-mgmt]",
      { category: "compensation", code: "MEMBERSHIP_CLEANUP_FAILED" },
    ]);
  });
});
