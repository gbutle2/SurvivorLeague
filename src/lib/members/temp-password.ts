const MIN_LENGTH = 20;

/**
 * Policy for commissioner-provided temporary passwords.
 * Never log, store in Postgres/metadata, or put in URLs.
 */
export function temporaryPasswordMeetsPolicy(password: string): boolean {
  if (password.length < MIN_LENGTH) return false;
  if (!/[A-Z]/.test(password)) return false;
  if (!/[a-z]/.test(password)) return false;
  if (!/[0-9]/.test(password)) return false;
  if (!/[!@#$%^&*\-_=+]/.test(password)) return false;
  return true;
}

export { MIN_LENGTH as TEMP_PASSWORD_MIN_LENGTH };
