export const MAX_ACTIVE_LEAGUE_MEMBERS = 6;

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
  | "member_limit"
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

export function validateNewPassword(password: string): string | null {
  if (password.length < 12) {
    return "Password must be at least 12 characters.";
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include uppercase, lowercase, and a number.";
  }
  return null;
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
