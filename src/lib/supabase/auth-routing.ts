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

type CookieReader = {
  getAll: () => Array<{ name: string; value: string }>;
};

type CookieWriter = {
  set: (name: string, value: string) => void;
};

/**
 * Copy cookies Supabase attached to the session response onto another response
 * (e.g. a redirect). Does not copy request cookies.
 */
export function copySessionCookiesOnto(
  source: CookieReader,
  target: CookieWriter,
): void {
  for (const cookie of source.getAll()) {
    target.set(cookie.name, cookie.value);
  }
}
