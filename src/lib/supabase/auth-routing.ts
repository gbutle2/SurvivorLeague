/**
 * Exact-path helpers for auth middleware (no broad prefix matching).
 */
export function isExactAppPath(pathname: string, route: string): boolean {
  if (pathname === route) return true;
  if (route !== "/" && pathname === `${route}/`) return true;
  return false;
}

export function isLoginPath(pathname: string): boolean {
  return isExactAppPath(pathname, "/login");
}

export function isChangePasswordPath(pathname: string): boolean {
  return isExactAppPath(pathname, "/change-password");
}

export function isCronNflSyncPath(pathname: string): boolean {
  return isExactAppPath(pathname, "/api/cron/nfl-sync");
}

export function resolveForcedPasswordRedirect(input: {
  authenticated: boolean;
  mustChangePassword: boolean;
  pathname: string;
}): string | null {
  const path = input.pathname;
  const isLogin = isLoginPath(path);
  const isChange = isChangePasswordPath(path);

  if (!input.authenticated && !isLogin) {
    return "/login";
  }
  if (input.authenticated && input.mustChangePassword && !isChange) {
    return "/change-password";
  }
  if (input.authenticated && !input.mustChangePassword && isChange) {
    return "/";
  }
  if (input.authenticated && isLogin) {
    return input.mustChangePassword ? "/change-password" : "/";
  }
  return null;
}

/**
 * Cookie shape returned by Next.js `ResponseCookies.getAll()` / accepted by
 * `ResponseCookies.set(cookie)`. Includes security attributes Supabase sets.
 */
export type SessionResponseCookie = {
  name: string;
  value: string;
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date | number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: true | false | "lax" | "strict" | "none";
  priority?: "low" | "medium" | "high";
  partitioned?: boolean;
};

type CookieReader = {
  getAll: () => SessionResponseCookie[];
};

type CookieWriter = {
  /** Must accept the complete cookie object — not only name/value. */
  set: (cookie: SessionResponseCookie) => void;
};

/**
 * Copy cookies Supabase attached to the session response onto another response
 * (e.g. a redirect). Passes each complete cookie object through so attributes
 * such as httpOnly, secure, sameSite, path, domain, maxAge/expires, priority,
 * and partitioned are preserved. Does not copy request cookies.
 */
export function copySessionCookiesOnto(
  source: CookieReader,
  target: CookieWriter,
): void {
  for (const cookie of source.getAll()) {
    target.set(cookie);
  }
}
