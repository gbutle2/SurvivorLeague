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

  function assertSafeCompensationLog(code: string) {
    assert.equal(logs.length >= 1, true);
    for (const entry of logs) {
      assert.deepEqual(entry, ["[member-mgmt]", { category: "compensation", code }]);
      const payload = JSON.stringify(entry);
      assert.equal(payload.includes("SECRET"), false);
      assert.equal(payload.includes("permission"), false);
      assert.equal(payload.includes("service_role"), false);
      assert.equal(payload.includes("TEMP_PASSWORD"), false);
      assert.equal(payload.includes("user-"), false);
    }
  }

  function membershipOk() {
    return {
      from: () => ({
        delete: () => ({
          eq: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
      }),
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
        ...membershipOk(),
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

  it("membership delete returns { error } and Auth deletion is still attempted", async () => {
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
    assertSafeCompensationLog("MEMBERSHIP_CLEANUP_FAILED");
  });

  it("membership delete rejects and Auth deletion is still attempted", async () => {
    captureLogs();
    let deletedAuth = false;
    await compensateFailedPlayerSetup(
      {
        from: () => ({
          delete: () => ({
            eq: () => ({
              eq: async () => {
                throw new Error("network down SECRET user-123@example.com");
              },
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
    assertSafeCompensationLog("MEMBERSHIP_CLEANUP_FAILED");
  });

  it("Auth deletion returns { error } safely", async () => {
    captureLogs();
    await compensateFailedPlayerSetup(
      {
        ...membershipOk(),
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
    assertSafeCompensationLog("AUTH_DELETE_FAILED");
  });

  it("Auth deletion rejects safely", async () => {
    captureLogs();
    await compensateFailedPlayerSetup(
      {
        ...membershipOk(),
        auth: {
          admin: {
            deleteUser: async () => {
              throw new Error("Auth Admin exploded TEMP_PASSWORD_xyz");
            },
          },
        },
      },
      { leagueId: "league-1", userId: "new-user", deleteAuthUser: true },
    );
    assertSafeCompensationLog("AUTH_DELETE_FAILED");
  });

  it("deleteAuthUser false never calls Auth deletion", async () => {
    let deletedAuth = false;
    await compensateFailedPlayerSetup(
      {
        from: () => ({
          delete: () => ({
            eq: () => ({
              eq: async () => {
                throw new Error("membership cleanup threw");
              },
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

  it("cleanup failures do not throw (original create error remains caller's)", async () => {
    captureLogs();
    await compensateFailedPlayerSetup(
      {
        from: () => ({
          delete: () => ({
            eq: () => ({
              eq: async () => {
                throw new Error("membership boom");
              },
            }),
          }),
        }),
        auth: {
          admin: {
            deleteUser: async () => {
              throw new Error("auth boom");
            },
          },
        },
      },
      { leagueId: "league-1", userId: "new-user", deleteAuthUser: true },
    );
    assert.equal(logs.length, 2);
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
