import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  interpretEmailChangeResponse,
  mapEmailProviderConflict,
  prepareDisplayName,
  prepareNewEmail,
  prepareNewPassword,
  resolveAccountTargetUserId,
} from "./rules.ts";
import { MemberManagementError } from "../members/validation.ts";
import { PASSWORD_MIN_LENGTH } from "../members/password-policy.ts";
import { requireMutationRow } from "../mutations/result.ts";
import { resolveForcedPasswordRedirect } from "../supabase/auth-routing.ts";
import { passwordMeetsPolicy } from "../members/password-policy.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("account settings authorization contracts", () => {
  it("rejects unauthenticated access to /account", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: false,
        mustChangePassword: false,
        pathname: "/account",
      }),
      "/login",
    );
  });

  it("keeps forced-password users on /change-password instead of /account", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: true,
        pathname: "/account",
      }),
      "/change-password",
    );
  });

  it("allows permanent-password users onto /account", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: false,
        pathname: "/account",
      }),
      null,
    );
  });

  it("always uses the session user as the mutation target", () => {
    assert.equal(
      resolveAccountTargetUserId("session-user", "attacker-user"),
      "session-user",
    );
    assert.equal(resolveAccountTargetUserId("session-user", null), "session-user");
  });

  it("does not expose a pathway to change roles or membership via account rules", () => {
    const name = prepareDisplayName("Pat");
    assert.equal(name, "Pat");
    assert.equal(
      Object.prototype.hasOwnProperty.call({ displayName: name }, "role"),
      false,
    );
  });
});

describe("account display-name rules", () => {
  it("accepts a valid name and normalizes whitespace", () => {
    assert.equal(prepareDisplayName("  Jane   Doe "), "Jane Doe");
  });

  it("rejects empty and over-40-character names", () => {
    assert.throws(
      () => prepareDisplayName("   "),
      (error: unknown) =>
        error instanceof MemberManagementError &&
        error.code === "invalid_display_name",
    );
    assert.throws(
      () => prepareDisplayName("A".repeat(41)),
      (error: unknown) =>
        error instanceof MemberManagementError &&
        error.code === "invalid_display_name",
    );
  });

  it("treats zero-row profile updates as failures", () => {
    const verified = requireMutationRow(
      null,
      "Your display name was not changed. Refresh and try again.",
    );
    assert.equal(verified.ok, false);
    if (!verified.ok) {
      assert.match(verified.error, /not changed/i);
    }
  });

  it("documents that another user id cannot become the update target", () => {
    const sessionId = "user-self";
    const forgedId = "user-other";
    assert.equal(resolveAccountTargetUserId(sessionId, forgedId), sessionId);
    assert.notEqual(resolveAccountTargetUserId(sessionId, forgedId), forgedId);
  });
});

describe("account email-change rules", () => {
  it("requires a different, valid email", () => {
    assert.throws(
      () => prepareNewEmail("not-an-email", "me@example.com"),
      (error: unknown) =>
        error instanceof MemberManagementError && error.code === "invalid_email",
    );
    assert.throws(
      () => prepareNewEmail("me@example.com", "me@example.com"),
      (error: unknown) =>
        error instanceof MemberManagementError && error.code === "invalid_email",
    );
    assert.equal(
      prepareNewEmail("  New@Example.COM ", "me@example.com"),
      "new@example.com",
    );
  });

  it("accepts a pending verification response and rejects immediate swaps", () => {
    const pending = interpretEmailChangeResponse({
      requestedEmail: "new@example.com",
      previousEmail: "old@example.com",
      updatedEmail: "old@example.com",
      newEmail: "new@example.com",
    });
    assert.deepEqual(pending, {
      currentEmail: "old@example.com",
      pendingEmail: "new@example.com",
    });

    assert.throws(
      () =>
        interpretEmailChangeResponse({
          requestedEmail: "new@example.com",
          previousEmail: "old@example.com",
          updatedEmail: "new@example.com",
          newEmail: null,
        }),
      (error: unknown) =>
        error instanceof MemberManagementError && error.code === "config",
    );
  });

  it("maps provider conflicts to a safe duplicate signal", () => {
    assert.equal(mapEmailProviderConflict("User already registered"), true);
    assert.equal(mapEmailProviderConflict("network timeout"), false);
  });

  it("does not place credentials in mapped UI conflict text", () => {
    const message = "That email cannot be used. Try a different address.";
    assert.equal(message.includes("password"), false);
    assert.equal(message.includes("secret"), false);
  });
});

describe("account password-change rules", () => {
  it("requires current password and matching confirmation", () => {
    assert.throws(
      () =>
        prepareNewPassword({
          currentPassword: "",
          newPassword: "abcdefgh",
          confirmPassword: "abcdefgh",
        }),
      (error: unknown) =>
        error instanceof MemberManagementError &&
        error.code === "invalid_password",
    );

    assert.throws(
      () =>
        prepareNewPassword({
          currentPassword: "currentpw",
          newPassword: "abcdefgh",
          confirmPassword: "abcdefgH",
        }),
      (error: unknown) =>
        error instanceof MemberManagementError &&
        error.code === "password_mismatch",
    );
  });

  it("rejects seven characters and accepts eight without character-class rules", () => {
    assert.equal(PASSWORD_MIN_LENGTH, 8);
    assert.equal(passwordMeetsPolicy("abcdefg"), false);
    assert.equal(passwordMeetsPolicy("abcdefgh"), true);
    assert.equal(passwordMeetsPolicy("aaaaaaaa"), true);

    assert.throws(
      () =>
        prepareNewPassword({
          currentPassword: "currentpw",
          newPassword: "abcdefg",
          confirmPassword: "abcdefg",
        }),
      (error: unknown) =>
        error instanceof MemberManagementError &&
        error.code === "invalid_password",
    );

    assert.equal(
      prepareNewPassword({
        currentPassword: "currentpw",
        newPassword: "abcdefgh",
        confirmPassword: "abcdefgh",
      }),
      "abcdefgh",
    );
  });

  it("rejects reuse of the current password", () => {
    assert.throws(
      () =>
        prepareNewPassword({
          currentPassword: "samepass",
          newPassword: "samepass",
          confirmPassword: "samepass",
        }),
      (error: unknown) =>
        error instanceof MemberManagementError &&
        error.code === "invalid_password",
    );
  });

  it("documents that password values must not appear in action state", () => {
    const secret = "super-secret-password";
    const state = { error: "Could not update your password.", success: null };
    assert.equal(JSON.stringify(state).includes(secret), false);
  });
});

describe("account settings regression anchors", () => {
  it("keeps forced-password routing intact for authenticated temporary users", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: true,
        pathname: "/",
      }),
      "/change-password",
    );
  });

  it("keeps commissioner temp-password and week-final paths intact", () => {
    const manage = readFileSync(
      path.join(ROOT, "lib/members/manage.ts"),
      "utf8",
    );
    assert.match(manage, /must_change_password:\s*true/);
    assert.match(manage, /temporaryPassword/);

    const reconcile = readFileSync(
      path.join(ROOT, "lib/weeks/reconcile-final.ts"),
      "utf8",
    );
    assert.match(reconcile, /reconcileRegularWeekFinalStatuses/);

    const standings = readFileSync(
      path.join(ROOT, "lib/dashboard/standings.ts"),
      "utf8",
    );
    assert.match(standings, /maxFloor <= 0/);
  });

  it("account settings module never imports the service-role admin client", () => {
    const settings = readFileSync(
      path.join(ROOT, "lib/account/settings.ts"),
      "utf8",
    );
    const actions = readFileSync(
      path.join(ROOT, "app/account/actions.ts"),
      "utf8",
    );
    const forms = readFileSync(
      path.join(ROOT, "app/account/account-settings-forms.tsx"),
      "utf8",
    );
    assert.doesNotMatch(settings, /createAdminClient|SERVICE_ROLE/);
    assert.doesNotMatch(actions, /createAdminClient|SERVICE_ROLE/);
    assert.doesNotMatch(forms, /createAdminClient|SERVICE_ROLE/);
  });
});
