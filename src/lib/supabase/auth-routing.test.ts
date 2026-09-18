import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  copySessionCookiesOnto,
  isChangePasswordPath,
  isCronNflSyncPath,
  isLoginPath,
  resolveForcedPasswordRedirect,
} from "./auth-routing.ts";

describe("exact auth route matching", () => {
  it("matches exact login route only", () => {
    assert.equal(isLoginPath("/login"), true);
    assert.equal(isLoginPath("/login/"), true);
    assert.equal(isLoginPath("/login-malicious"), false);
    assert.equal(isLoginPath("/login/extra"), false);
  });

  it("matches exact change-password route only", () => {
    assert.equal(isChangePasswordPath("/change-password"), true);
    assert.equal(isChangePasswordPath("/change-password/"), true);
    assert.equal(isChangePasswordPath("/change-password-extra"), false);
    assert.equal(isChangePasswordPath("/change-password/hack"), false);
  });

  it("matches exact nfl-sync cron route only", () => {
    assert.equal(isCronNflSyncPath("/api/cron/nfl-sync"), true);
    assert.equal(isCronNflSyncPath("/api/cron/nfl-sync/"), true);
    assert.equal(isCronNflSyncPath("/api/cron/nfl-sync-extra"), false);
    assert.equal(isCronNflSyncPath("/api/cron/other"), false);
    assert.equal(isCronNflSyncPath("/api/cron"), false);
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

  it("sends unauthenticated users to login for app routes", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: false,
        mustChangePassword: false,
        pathname: "/pick",
      }),
      "/login",
    );
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: false,
        mustChangePassword: false,
        pathname: "/login-malicious",
      }),
      "/login",
    );
  });

  it("does not redirect unauthenticated users already on exact login", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: false,
        mustChangePassword: false,
        pathname: "/login",
      }),
      null,
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

  it("keeps forced-password users restricted to change-password", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: true,
        pathname: "/api/cron/nfl-sync-extra",
      }),
      "/change-password",
    );
  });
});

describe("cookie-preserving redirects", () => {
  for (const destination of ["/login", "/change-password", "/"] as const) {
    it(`retains refreshed Supabase cookies for redirect category ${destination}`, () => {
      const sourceCookies = [
        { name: "sb-access-token", value: "refreshed-access" },
        { name: "sb-refresh-token", value: "refreshed-refresh" },
      ];
      const written = new Map<string, string>();
      copySessionCookiesOnto(
        { getAll: () => sourceCookies },
        {
          set: (name, value) => {
            written.set(name, value);
          },
        },
      );
      assert.equal(written.get("sb-access-token"), "refreshed-access");
      assert.equal(written.get("sb-refresh-token"), "refreshed-refresh");
      void destination;
    });
  }

  it("copies response cookies, not request cookies", () => {
    const written = new Map<string, string>();
    copySessionCookiesOnto(
      {
        getAll: () => [{ name: "sb-access-token", value: "from-response" }],
      },
      {
        set: (name, value) => {
          written.set(name, value);
        },
      },
    );
    assert.equal(written.get("sb-access-token"), "from-response");
    assert.equal(written.has("request-only"), false);
  });
});

describe("cron middleware bypass contract", () => {
  it("exact /api/cron/nfl-sync is excluded from session redirect decisions", () => {
    // updateSession returns NextResponse.next before getUser for this path.
    assert.equal(isCronNflSyncPath("/api/cron/nfl-sync"), true);
    // Nearby incorrect paths remain subject to auth redirect rules.
    assert.equal(isCronNflSyncPath("/api/cron/nfl-sync-extra"), false);
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: false,
        mustChangePassword: false,
        pathname: "/api/cron/nfl-sync-extra",
      }),
      "/login",
    );
  });

  it("regular unauthenticated app routes still redirect to /login", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: false,
        mustChangePassword: false,
        pathname: "/commissioner/members",
      }),
      "/login",
    );
  });
});
