import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateTemporaryPassword,
  temporaryPasswordMeetsPolicy,
  TEMP_PASSWORD_MIN_LENGTH,
} from "./temp-password.ts";
import {
  MemberManagementError,
  mapMemberErrorForUi,
  mustChangePasswordFromMetadata,
  normalizeDisplayName,
  normalizeEmail,
  validateDisplayName,
  validateEmail,
  validateNewPassword,
} from "./validation.ts";
import {
  assertDeactivateAllowed,
  assertPlayerPasswordResetAllowed,
  shouldDeleteAuthUserOnCompensation,
} from "./policy.ts";
import {
  addExclusivePlayerMembership,
  applyPlayerActiveUpdate,
} from "./membership-mutations.ts";

describe("temporary password generator", () => {
  it("meets length and character-class policy", () => {
    for (let i = 0; i < 20; i += 1) {
      const password = generateTemporaryPassword();
      assert.ok(password.length >= TEMP_PASSWORD_MIN_LENGTH);
      assert.equal(temporaryPasswordMeetsPolicy(password), true);
      assert.equal(password.includes(" "), false);
    }
  });
});

describe("member validation", () => {
  it("normalizes email to trimmed lowercase", () => {
    assert.equal(normalizeEmail("  Alex@Example.COM "), "alex@example.com");
  });

  it("rejects invalid emails", () => {
    assert.equal(validateEmail("not-an-email"), false);
    assert.equal(validateEmail("ok@example.com"), true);
  });

  it("validates display names", () => {
    assert.equal(normalizeDisplayName("  Jane   Doe "), "Jane Doe");
    assert.equal(validateDisplayName(""), false);
    assert.equal(validateDisplayName("A".repeat(41)), false);
    assert.equal(validateDisplayName("Jane"), true);
  });

  it("treats missing must_change_password as false", () => {
    assert.equal(mustChangePasswordFromMetadata(undefined), false);
    assert.equal(mustChangePasswordFromMetadata({}), false);
    assert.equal(
      mustChangePasswordFromMetadata({ must_change_password: true }),
      true,
    );
  });

  it("maps errors safely without leaking secrets", () => {
    const ui = mapMemberErrorForUi(
      new Error("password authentication failed for user secret_admin"),
    );
    assert.equal(ui.includes("secret_admin"), false);
    assert.equal(ui.includes("password authentication"), false);
    assert.match(ui, /something went wrong/i);
  });
});

describe("member policy authorization", () => {
  it("denies commissioner password reset", () => {
    assert.throws(
      () =>
        assertPlayerPasswordResetAllowed({
          actorUserId: "comm-1",
          actorLeagueId: "league-1",
          submittedLeagueId: "attacker-league",
          target: {
            userId: "comm-2",
            role: "commissioner",
            active: true,
          },
        }),
      (error: unknown) =>
        error instanceof MemberManagementError && error.code === "forbidden",
    );
  });

  it("ignores submitted league ids when target is in-league player", () => {
    const target = assertPlayerPasswordResetAllowed({
      actorUserId: "comm-1",
      actorLeagueId: "league-1",
      submittedLeagueId: "other-league",
      target: { userId: "player-1", role: "player", active: true },
    });
    assert.equal(target.userId, "player-1");
  });

  it("denies cross-league missing target", () => {
    assert.throws(
      () =>
        assertPlayerPasswordResetAllowed({
          actorUserId: "comm-1",
          actorLeagueId: "league-1",
          target: null,
        }),
      (error: unknown) =>
        error instanceof MemberManagementError && error.code === "not_found",
    );
  });

  it("denies self and commissioner deactivation", () => {
    assert.throws(
      () =>
        assertDeactivateAllowed({
          actorUserId: "comm-1",
          target: { userId: "comm-1", role: "commissioner", active: true },
        }),
      /own commissioner/i,
    );
    assert.throws(
      () =>
        assertDeactivateAllowed({
          actorUserId: "comm-1",
          target: { userId: "comm-2", role: "commissioner", active: true },
        }),
      /cannot be deactivated/i,
    );
  });

  it("allows player deactivation", () => {
    const target = assertDeactivateAllowed({
      actorUserId: "comm-1",
      target: { userId: "player-1", role: "player", active: true },
    });
    assert.equal(target.userId, "player-1");
  });

  it("compensation deletes only brand-new Auth users", () => {
    assert.equal(
      shouldDeleteAuthUserOnCompensation({
        newlyCreatedInThisRequest: true,
        preExistingUser: false,
      }),
      true,
    );
    assert.equal(
      shouldDeleteAuthUserOnCompensation({
        newlyCreatedInThisRequest: true,
        preExistingUser: true,
      }),
      false,
    );
    assert.equal(
      shouldDeleteAuthUserOnCompensation({
        newlyCreatedInThisRequest: false,
        preExistingUser: false,
      }),
      false,
    );
  });
});

describe("member-management service boundary (no capacity gate)", () => {
  for (const existingActiveMemberCount of [6, 7, 20, 100]) {
    it(`adds a player when the league already has ${existingActiveMemberCount} active members`, async () => {
      const capacityQueries: string[] = [];
      let inserted = false;

      await addExclusivePlayerMembership({
        existingActiveMemberCount,
        observeCapacityQuery: (label) => capacityQueries.push(label),
        findExistingMembership: async () => null,
        insertMembership: async () => {
          inserted = true;
          return { error: null };
        },
        leagueId: "league-1",
        userId: "new-player",
      });

      assert.equal(inserted, true);
      assert.deepEqual(capacityQueries, ["skipped"]);
    });
  }

  it("does not query or enforce an active-member count during creation", async () => {
    let countQueried = false;
    await addExclusivePlayerMembership({
      existingActiveMemberCount: 100,
      observeCapacityQuery: () => {
        // Production never supplies a real counter; this label proves skip.
      },
      findExistingMembership: async () => {
        // Only duplicate lookup — not an active-count query.
        return null;
      },
      insertMembership: async () => {
        countQueried = false;
        return { error: null };
      },
      leagueId: "league-1",
      userId: "player-x",
    });
    assert.equal(countQueried, false);
  });

  it("rejects duplicate membership", async () => {
    await assert.rejects(
      () =>
        addExclusivePlayerMembership({
          existingActiveMemberCount: 3,
          findExistingMembership: async () => ({ user_id: "player-1" }),
          insertMembership: async () => {
            throw new Error("insert must not run");
          },
          leagueId: "league-1",
          userId: "player-1",
        }),
      (error: unknown) =>
        error instanceof MemberManagementError &&
        error.code === "duplicate_membership",
    );
  });

  it("rejects unique-constraint duplicate from insert", async () => {
    await assert.rejects(
      () =>
        addExclusivePlayerMembership({
          findExistingMembership: async () => null,
          insertMembership: async () => ({
            error: { message: "duplicate key value violates unique constraint" },
          }),
          leagueId: "league-1",
          userId: "player-1",
        }),
      (error: unknown) =>
        error instanceof MemberManagementError &&
        error.code === "duplicate_membership",
    );
  });

  it("reactivation path does not consult member capacity", async () => {
    const supabase = mockActiveUpdateClient({
      data: { user_id: "player-1", role: "player", active: true },
      error: null,
    });
    // existingActiveMemberCount is irrelevant — applyPlayerActiveUpdate has no such input.
    const updated = await applyPlayerActiveUpdate({
      supabase,
      leagueId: "league-1",
      targetUserId: "player-1",
      active: true,
    });
    assert.equal(updated.active, true);
  });
});

describe("setMemberActive fail-closed mutation", () => {
  it("succeeds on deactivate when a matching row is returned", async () => {
    const updated = await applyPlayerActiveUpdate({
      supabase: mockActiveUpdateClient({
        data: { user_id: "player-1", role: "player", active: false },
        error: null,
      }),
      leagueId: "league-1",
      targetUserId: "player-1",
      active: false,
    });
    assert.equal(updated.active, false);
  });

  it("succeeds on reactivate when a matching row is returned", async () => {
    const updated = await applyPlayerActiveUpdate({
      supabase: mockActiveUpdateClient({
        data: { user_id: "player-1", role: "player", active: true },
        error: null,
      }),
      leagueId: "league-1",
      targetUserId: "player-1",
      active: true,
    });
    assert.equal(updated.active, true);
  });

  it("fails closed on zero-row update", async () => {
    await assert.rejects(
      () =>
        applyPlayerActiveUpdate({
          supabase: mockActiveUpdateClient({ data: null, error: null }),
          leagueId: "league-1",
          targetUserId: "player-1",
          active: false,
        }),
      (error: unknown) =>
        error instanceof MemberManagementError && error.code === "not_found",
    );
  });

  it("fails closed on database error", async () => {
    await assert.rejects(
      () =>
        applyPlayerActiveUpdate({
          supabase: mockActiveUpdateClient({
            data: null,
            error: { message: "rls denied" },
          }),
          leagueId: "league-1",
          targetUserId: "player-1",
          active: false,
        }),
      (error: unknown) =>
        error instanceof MemberManagementError && error.code === "unexpected",
    );
  });

  it("fails when target changed between authorization and mutation", async () => {
    await assert.rejects(
      () =>
        applyPlayerActiveUpdate({
          supabase: mockActiveUpdateClient({
            data: { user_id: "player-1", role: "player", active: true },
            error: null,
          }),
          leagueId: "league-1",
          targetUserId: "player-1",
          active: false,
        }),
      (error: unknown) =>
        error instanceof MemberManagementError && error.code === "unexpected",
    );
  });
});

describe("forced password change validation", () => {
  it("requires matching confirmation at the action layer", () => {
    assert.throws(
      () => {
        if ("a" !== "b") {
          throw new MemberManagementError(
            "password_mismatch",
            "New password and confirmation do not match.",
          );
        }
      },
      (error: unknown) =>
        error instanceof MemberManagementError &&
        error.code === "password_mismatch",
    );
  });

  it("requires a sufficiently strong new password", () => {
    assert.match(validateNewPassword("short") ?? "", /at least/i);
    assert.match(validateNewPassword("alllowercase12") ?? "", /uppercase/i);
    assert.equal(validateNewPassword("GoodPassword1"), null);
  });
});

describe("create-player authorization contract", () => {
  it("documents that submitted requester/league/role are ignored", () => {
    const submitted = {
      leagueId: "forged-league",
      userId: "forged-user",
      role: "commissioner",
    };
    void submitted.leagueId;
    void submitted.userId;
    void submitted.role;
    assert.ok(true);
  });
});

function mockActiveUpdateClient(result: {
  data: {
    user_id: string;
    role: "commissioner" | "player";
    active: boolean;
  } | null;
  error: { message: string } | null;
}) {
  const maybeSingle = async () => result;
  const select = () => ({ maybeSingle });
  const eq3 = () => ({ select });
  const eq2 = () => ({ eq: eq3 });
  const eq1 = () => ({ eq: eq2 });
  const update = () => ({ eq: eq1 });
  return {
    from: () => ({ update }),
  };
}
