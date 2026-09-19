/**
 * Shared password policy for temporary and permanent passwords.
 * Never log, store in Postgres/metadata, or put in URLs.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** User-facing policy copy — keep identical across create, reset, and change flows. */
export const PASSWORD_POLICY_HINT = "Use at least 8 characters.";

export function passwordMeetsPolicy(password: unknown): boolean {
  return typeof password === "string" && password.length >= PASSWORD_MIN_LENGTH;
}

/** Returns a safe UI message when the password fails policy; otherwise null. */
export function validatePassword(password: unknown): string | null {
  if (!passwordMeetsPolicy(password)) {
    return PASSWORD_POLICY_HINT;
  }
  return null;
}
