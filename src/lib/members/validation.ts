export const DISPLAY_NAME_MIN = 1;
export const DISPLAY_NAME_MAX = 40;

export type MemberErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_email"
  | "invalid_display_name"
  | "invalid_password"
  | "password_mismatch"
  | "duplicate_email"
  | "duplicate_membership"
  | "not_found"
  | "conflict"
  | "setup_failed"
  | "config"
  | "unexpected";

export class MemberManagementError extends Error {
  readonly code: MemberErrorCode;

  constructor(code: MemberErrorCode, message: string) {
    super(message);
    this.name = "MemberManagementError";
    this.code = code;
  }
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateEmail(email: string): boolean {
  if (email.length < 5 || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function normalizeDisplayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function validateDisplayName(name: string): boolean {
  return (
    name.length >= DISPLAY_NAME_MIN && name.length <= DISPLAY_NAME_MAX
  );
}

export function mustChangePasswordFromMetadata(
  appMetadata: Record<string, unknown> | null | undefined,
): boolean {
  return appMetadata?.must_change_password === true;
}

import { validatePassword } from "./password-policy.ts";

/** Permanent-password policy — same shared rule as temporary passwords. */
export function validateNewPassword(password: string): string | null {
  return validatePassword(password);
}

export function mapMemberErrorForUi(error: unknown): string {
  if (error instanceof MemberManagementError) {
    return error.message;
  }
  return "Something went wrong. Try again or contact the commissioner.";
}

export function logMemberError(category: string, code: string): void {
  console.error("[member-mgmt]", { category, code });
}
