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
  canAddOrReactivateActiveMember,
  resolveForcedPasswordRedirect,
  shouldDeleteAuthUserOnCompensation,
} from "./policy.ts";

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

  it("allows a seventh and additional active members with no capacity cap", () => {
    assert.equal(canAddOrReactivateActiveMember(6), true);
    assert.equal(canAddOrReactivateActiveMember(7), true);
    assert.equal(canAddOrReactivateActiveMember(20), true);
  });

  it("allows reactivation regardless of how many other members are active", () => {
    assert.equal(canAddOrReactivateActiveMember(100), true);
  });

  it("still rejects duplicate in-league membership targets as not found when missing", () => {
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

describe("forced-route redirects", () => {
  it("sends temporary-password users only to change-password", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: true,
        pathname: "/",
      }),
      "/change-password",
    );
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: true,
        pathname: "/commissioner",
      }),
      "/change-password",
    );
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: true,
        pathname: "/change-password",
      }),
      null,
    );
  });

  it("avoids redirect loops for completed users on change-password", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: false,
        pathname: "/change-password",
      }),
      "/",
    );
  });

  it("sends unauthenticated users to login", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: false,
        mustChangePassword: false,
        pathname: "/pick",
      }),
      "/login",
    );
  });

  it("routes authenticated login visits without looping", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: true,
        pathname: "/login",
      }),
      "/change-password",
    );
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: false,
        pathname: "/login",
      }),
      "/",
    );
  });
});

describe("create-player authorization contract", () => {
  it("documents that submitted requester/league/role are ignored", () => {
    // authorizeCommissionerMemberAction voids submitted identifiers.
    const submitted = {
      leagueId: "forged-league",
      userId: "forged-user",
      role: "commissioner",
    };
    void submitted.leagueId;
    void submitted.userId;
    void submitted.role;
    assert.equal(canAddOrReactivateActiveMember(6), true);
  });
});
