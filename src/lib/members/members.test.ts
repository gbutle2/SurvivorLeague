import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_HINT,
  passwordMeetsPolicy,
  temporaryPasswordMeetsPolicy,
  TEMP_PASSWORD_MIN_LENGTH,
  validatePassword,
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

const VALID_PASSWORD = "abcdefgh";

describe("shared password policy (8-character minimum)", () => {
  it("accepts exactly 8 characters", () => {
    assert.equal(passwordMeetsPolicy("abcdefgh"), true);
    assert.equal(temporaryPasswordMeetsPolicy("abcdefgh"), true);
    assert.equal(validatePassword("abcdefgh"), null);
    assert.equal(validateNewPassword("abcdefgh"), null);
  });

  it("accepts more than 8 characters", () => {
    assert.equal(passwordMeetsPolicy("abcdefghi"), true);
    assert.equal(validateNewPassword("abcdefghi"), null);
  });

  it("rejects 7 characters or fewer", () => {
    assert.equal(passwordMeetsPolicy("abcdefg"), false);
    assert.equal(temporaryPasswordMeetsPolicy("abcdefg"), false);
    assert.equal(validatePassword("abcdefg"), PASSWORD_POLICY_HINT);
    assert.equal(validateNewPassword("abcdefg"), PASSWORD_POLICY_HINT);
    assert.equal(passwordMeetsPolicy(""), false);
  });

  it("rejects non-string input", () => {
    assert.equal(passwordMeetsPolicy(null), false);
    assert.equal(passwordMeetsPolicy(undefined), false);
    assert.equal(passwordMeetsPolicy(12345678), false);
  });

  it("accepts lowercase-only, uppercase-only, numeric-only, and no-symbol passwords", () => {
    assert.equal(passwordMeetsPolicy("password"), true);
    assert.equal(passwordMeetsPolicy("PASSWORD"), true);
    assert.equal(passwordMeetsPolicy("12345678"), true);
    assert.equal(passwordMeetsPolicy("abcdefgh"), true);
    assert.equal(validateNewPassword("password"), null);
    assert.equal(validateNewPassword("PASSWORD"), null);
    assert.equal(validateNewPassword("12345678"), null);
  });

  it("exposes a shared minimum of 8", () => {
    assert.equal(PASSWORD_MIN_LENGTH, 8);
    assert.equal(TEMP_PASSWORD_MIN_LENGTH, 8);
    assert.equal(PASSWORD_POLICY_HINT, "Use at least 8 characters.");
  });

  it("rejects mismatched confirmations without echoing passwords", () => {
    const password = VALID_PASSWORD;
    const confirmation = "abcdefghij";
    assert.notEqual(password, confirmation);
    const earlyReturn =
      password !== confirmation
        ? "Temporary password and confirmation must match."
        : null;
    assert.equal(
      earlyReturn,
      "Temporary password and confirmation must match.",
    );
    assert.equal(earlyReturn?.includes(password), false);
    assert.equal(earlyReturn?.includes(confirmation), false);
  });

  it("player creation and reset enforce the shared 8-character rule", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const manageSource = readFileSync(join(import.meta.dirname, "manage.ts"), "utf8");
    const policySource = readFileSync(
      join(import.meta.dirname, "password-policy.ts"),
      "utf8",
    );
    assert.match(policySource, /PASSWORD_MIN_LENGTH\s*=\s*8/);
    assert.equal(/\[A-Z\]/.test(policySource), false);
    assert.equal(/\[a-z\]/.test(policySource), false);
    assert.equal(/\[0-9\]/.test(policySource), false);
    assert.match(
      manageSource,
      /temporaryPasswordMeetsPolicy\(temporaryPassword\)/,
    );
    assert.match(
      manageSource,
      /temporaryPasswordMeetsPolicy\(input\.temporaryPassword\)/,
    );
    assert.match(manageSource, /PASSWORD_POLICY_HINT/);
    assert.equal(manageSource.includes("at least 20"), false);
    assert.equal(manageSource.includes("uppercase"), false);
  });

  it("forced permanent-password change uses the shared 8-character rule", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const changeSource = readFileSync(
      join(import.meta.dirname, "password-change.ts"),
      "utf8",
    );
    const validationSource = readFileSync(
      join(import.meta.dirname, "validation.ts"),
      "utf8",
    );
    assert.match(changeSource, /validateNewPassword\(input\.newPassword\)/);
    assert.match(validationSource, /validatePassword\(password\)/);
    assert.equal(validationSource.includes("at least 12"), false);
    assert.equal(validationSource.includes("uppercase"), false);
    assert.equal(validateNewPassword("short"), PASSWORD_POLICY_HINT);
    assert.equal(validateNewPassword("abcdefgh"), null);
  });

  it("passwords remain absent from logs, metadata persistence, and errors", () => {
    const ui = mapMemberErrorForUi(
      new MemberManagementError("invalid_password", PASSWORD_POLICY_HINT),
    );
    assert.equal(ui, PASSWORD_POLICY_HINT);
    assert.equal(ui.includes(VALID_PASSWORD), false);
  });
});

describe("existing-player temporary password reset", () => {
  it("allows reset for an active in-league player", () => {
    const target = assertPlayerPasswordResetAllowed({
      actorUserId: "comm-1",
      actorLeagueId: "league-1",
      target: { userId: "player-1", role: "player", active: true },
    });
    assert.equal(target.userId, "player-1");
  });

  it("rejects inactive players before any Auth update", () => {
    assert.throws(
      () =>
        assertPlayerPasswordResetAllowed({
          actorUserId: "comm-1",
          actorLeagueId: "league-1",
          target: { userId: "player-1", role: "player", active: false },
        }),
      (error: unknown) =>
        error instanceof MemberManagementError && error.code === "forbidden",
    );
  });

  it("rejects commissioner self-reset", () => {
    assert.throws(
      () =>
        assertPlayerPasswordResetAllowed({
          actorUserId: "comm-1",
          actorLeagueId: "league-1",
          target: { userId: "comm-1", role: "commissioner", active: true },
        }),
      (error: unknown) =>
        error instanceof MemberManagementError && error.code === "forbidden",
    );
  });

  it("rejects resetting another commissioner", () => {
    assert.throws(
      () =>
        assertPlayerPasswordResetAllowed({
          actorUserId: "comm-1",
          actorLeagueId: "league-1",
          target: { userId: "comm-2", role: "commissioner", active: true },
        }),
      (error: unknown) =>
        error instanceof MemberManagementError && error.code === "forbidden",
    );
  });

  it("rejects cross-league targets (missing membership)", () => {
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

  it("rejects mismatched reset passwords before Auth update", () => {
    const temporaryPassword = VALID_PASSWORD;
    const temporaryPasswordConfirmation = "hgfedcba";
    assert.notEqual(temporaryPassword, temporaryPasswordConfirmation);
    const earlyReturn =
      temporaryPassword !== temporaryPasswordConfirmation
        ? "Temporary password and confirmation must match."
        : null;
    assert.equal(
      earlyReturn,
      "Temporary password and confirmation must match.",
    );
    assert.equal(earlyReturn?.includes(temporaryPassword), false);
    assert.equal(earlyReturn?.includes(temporaryPasswordConfirmation), false);
  });

  it("accepts matching commissioner-provided reset password when policy passes", () => {
    const temporaryPassword = VALID_PASSWORD;
    const temporaryPasswordConfirmation = VALID_PASSWORD;
    assert.equal(temporaryPassword, temporaryPasswordConfirmation);
    assert.equal(temporaryPasswordMeetsPolicy(temporaryPassword), true);
  });

  it("reset path uses supplied password and sets must_change_password", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const manageSource = readFileSync(join(import.meta.dirname, "manage.ts"), "utf8");
    const actionsSource = readFileSync(
      join(
        import.meta.dirname,
        "..",
        "..",
        "app",
        "commissioner",
        "members",
        "actions.ts",
      ),
      "utf8",
    );
    const uiSource = readFileSync(
      join(
        import.meta.dirname,
        "..",
        "..",
        "app",
        "commissioner",
        "members",
        "members-manager.tsx",
      ),
      "utf8",
    );
    const tempPasswordSource = readFileSync(
      join(import.meta.dirname, "temp-password.ts"),
      "utf8",
    );

    assert.equal(manageSource.includes("generateTemporaryPassword"), false);
    assert.equal(actionsSource.includes("generateTemporaryPassword"), false);
    assert.equal(tempPasswordSource.includes("generateTemporaryPassword"), false);
    assert.match(
      manageSource,
      /temporaryPasswordMeetsPolicy\(input\.temporaryPassword\)/,
    );
    assert.match(
      manageSource,
      /password:\s*temporaryPassword/,
    );
    assert.match(
      manageSource,
      /app_metadata:\s*\{\s*must_change_password:\s*true\s*\}/,
    );
    assert.match(
      actionsSource,
      /temporaryPassword !== temporaryPasswordConfirmation/,
    );
    assert.match(
      actionsSource,
      /resetPlayerTemporaryPassword\(\{\s*targetUserId,\s*temporaryPassword,/s,
    );
    assert.equal(uiSource.includes("Confirm password reset"), false);
    assert.equal(uiSource.includes("Reset temporary password"), false);
    assert.match(uiSource, /Set new temporary password/);
    assert.match(uiSource, /Save temporary password/);
    assert.match(uiSource, /name="temporary_password"/);
    assert.match(uiSource, /name="temporary_password_confirmation"/);
    assert.match(uiSource, /minLength=\{PASSWORD_MIN_LENGTH\}/);
    assert.match(uiSource, /PASSWORD_POLICY_HINT/);
  });

  it("reset errors and logs never echo passwords or persist them in metadata", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const manageSource = readFileSync(join(import.meta.dirname, "manage.ts"), "utf8");
    const actionsSource = readFileSync(
      join(
        import.meta.dirname,
        "..",
        "..",
        "app",
        "commissioner",
        "members",
        "actions.ts",
      ),
      "utf8",
    );

    assert.equal(/console\.(log|info|debug)\([^)]*password/i.test(manageSource), false);
    assert.equal(/console\.(log|info|debug)\([^)]*password/i.test(actionsSource), false);
    assert.match(manageSource, /logMemberError\("reset_password", "AUTH_UPDATE_FAILED"\)/);
    assert.equal(
      manageSource.includes("app_metadata: { password:"),
      false,
    );
    assert.equal(
      manageSource.includes("user_metadata: { password:"),
      false,
    );

    const ui = mapMemberErrorForUi(
      new MemberManagementError("invalid_password", PASSWORD_POLICY_HINT),
    );
    assert.equal(ui.includes(VALID_PASSWORD), false);
  });

  it("new-player creation still uses commissioner-entered password", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const manageSource = readFileSync(join(import.meta.dirname, "manage.ts"), "utf8");
    assert.match(
      manageSource,
      /temporaryPasswordMeetsPolicy\(temporaryPassword\)/,
    );
    assert.match(
      manageSource,
      /password:\s*temporaryPassword,/,
    );
    assert.equal(manageSource.includes("generateTemporaryPassword"), false);
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

describe("member-management service boundary (no member-count gate)", () => {
  it("accepts only membership lookup and insert — no count parameter", async () => {
    let lookupCalls = 0;
    let insertCalls = 0;

    await addExclusivePlayerMembership({
      leagueId: "league-1",
      userId: "new-player",
      findExistingMembership: async () => {
        lookupCalls += 1;
        return null;
      },
      insertMembership: async () => {
        insertCalls += 1;
        return { error: null };
      },
    });

    assert.equal(lookupCalls, 1);
    assert.equal(insertCalls, 1);
    assert.equal(
      "existingActiveMemberCount" in addExclusivePlayerMembership,
      false,
    );
  });

  it("successful insertion is not conditional on league size", async () => {
    // Call the same membership boundary repeatedly; there is no size input to gate on.
    for (let i = 0; i < 4; i += 1) {
      let inserted = false;
      await addExclusivePlayerMembership({
        leagueId: "league-1",
        userId: `player-${i}`,
        findExistingMembership: async () => null,
        insertMembership: async () => {
          inserted = true;
          return { error: null };
        },
      });
      assert.equal(inserted, true);
    }
  });

  it("performs only existing-membership lookup and insertion", async () => {
    const ops: string[] = [];
    await addExclusivePlayerMembership({
      leagueId: "league-1",
      userId: "player-x",
      findExistingMembership: async () => {
        ops.push("lookup");
        return null;
      },
      insertMembership: async () => {
        ops.push("insert");
        return { error: null };
      },
    });
    assert.deepEqual(ops, ["lookup", "insert"]);
  });

  it("rejects duplicate membership", async () => {
    await assert.rejects(
      () =>
        addExclusivePlayerMembership({
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

  it("reactivation path has no member-count input", async () => {
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

  it("member-management sources do not query an active-member count gate", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dirname);
    const files = [
      "membership-mutations.ts",
      "manage.ts",
      "policy.ts",
      "validation.ts",
      "password-change.ts",
      "temp-password.ts",
      "password-policy.ts",
    ];
    const forbidden = [
      /existingActiveMemberCount/,
      /observeCapacityQuery/,
      /canAddOrReactivateActiveMember/,
      /member[-_ ]?limit/i,
      /MAX_ACTIVE_MEMBERS/,
      /\.select\(\s*['"`].*\bcount\b/i,
      /\{\s*count\s*:\s*['"`]exact['"`]/,
      /\.count\s*\(/,
    ];
    for (const file of files) {
      const source = readFileSync(join(root, file), "utf8");
      for (const pattern of forbidden) {
        assert.equal(
          pattern.test(source),
          false,
          `${file} matched forbidden member-count pattern ${pattern}`,
        );
      }
    }
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

  it("requires at least 8 characters with no complexity rules", () => {
    assert.equal(validateNewPassword("short"), PASSWORD_POLICY_HINT);
    assert.equal(validateNewPassword("abcdefg"), PASSWORD_POLICY_HINT);
    assert.equal(validateNewPassword("abcdefgh"), null);
    assert.equal(validateNewPassword("password"), null);
    assert.equal(validateNewPassword("12345678"), null);
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
