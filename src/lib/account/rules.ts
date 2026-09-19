import { authenticatedUserId } from "../auth/identity.ts";
import {
  PASSWORD_POLICY_HINT,
  validatePassword,
} from "../members/password-policy.ts";
import {
  MemberManagementError,
  normalizeDisplayName,
  normalizeEmail,
  validateDisplayName,
  validateEmail,
} from "../members/validation.ts";

/** Normalize and validate a self-service display name. */
export function prepareDisplayName(raw: string): string {
  const displayName = normalizeDisplayName(raw);
  if (!validateDisplayName(displayName)) {
    throw new MemberManagementError(
      "invalid_display_name",
      "Display name must be 1–40 characters.",
    );
  }
  return displayName;
}

/** Normalize and validate a requested email change target. */
export function prepareNewEmail(raw: string, currentEmail: string): string {
  const newEmail = normalizeEmail(raw);
  if (!validateEmail(newEmail)) {
    throw new MemberManagementError(
      "invalid_email",
      "Enter a valid email address.",
    );
  }
  if (newEmail === normalizeEmail(currentEmail)) {
    throw new MemberManagementError(
      "invalid_email",
      "Enter a different email address.",
    );
  }
  return newEmail;
}

/** Validate self-service password change inputs before Auth calls. */
export function prepareNewPassword(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): string {
  if (!input.currentPassword) {
    throw new MemberManagementError(
      "invalid_password",
      "Enter your current password.",
    );
  }
  if (input.newPassword !== input.confirmPassword) {
    throw new MemberManagementError(
      "password_mismatch",
      "New password and confirmation must match.",
    );
  }
  const policyError = validatePassword(input.newPassword);
  if (policyError) {
    throw new MemberManagementError("invalid_password", PASSWORD_POLICY_HINT);
  }
  if (input.newPassword === input.currentPassword) {
    throw new MemberManagementError(
      "invalid_password",
      "Choose a new password that is different from your current password.",
    );
  }
  return input.newPassword;
}

/**
 * Interpret Auth updateUser email response.
 * Requires a pending confirmation — never treat an immediate email swap as success.
 */
export function interpretEmailChangeResponse(input: {
  requestedEmail: string;
  previousEmail: string;
  updatedEmail: string | null | undefined;
  newEmail: string | null | undefined;
}): { currentEmail: string; pendingEmail: string } {
  const requested = normalizeEmail(input.requestedEmail);
  const previous = normalizeEmail(input.previousEmail);
  const current = normalizeEmail(input.updatedEmail ?? "");
  const pending =
    typeof input.newEmail === "string" && input.newEmail.length > 0
      ? normalizeEmail(input.newEmail)
      : null;

  if (current === requested && !pending) {
    throw new MemberManagementError(
      "config",
      "Email confirmation is not configured correctly on this project. Contact the commissioner.",
    );
  }

  if (pending === requested && current === previous) {
    return { currentEmail: current, pendingEmail: pending };
  }

  throw new MemberManagementError(
    "unexpected",
    "Could not confirm the email-change request state. Check your inbox and try again if needed.",
  );
}

/** Session user always wins over any submitted user id. */
export function resolveAccountTargetUserId(
  sessionUserId: string,
  submittedUserId?: string | null,
): string {
  return authenticatedUserId(sessionUserId, submittedUserId);
}

export function mapEmailProviderConflict(message: string): boolean {
  return /already.*(registered|exists|been)|duplicate|unique.*email/i.test(
    message,
  );
}
