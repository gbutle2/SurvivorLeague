import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  copySessionCookiesOnto,
  isChangePasswordPath,
  isCronNflSyncPath,
  isLoginPath,
  resolveForcedPasswordRedirect,
  type SessionResponseCookie,
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

  it("sends unauthenticated /account visitors to login", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: false,
        mustChangePassword: false,
        pathname: "/account",
      }),
      "/login",
    );
  });

  it("blocks forced-password users from /account", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: true,
        pathname: "/account",
      }),
      "/change-password",
    );
  });
});

describe("cookie-preserving redirects", () => {
  const sampleCookies: SessionResponseCookie[] = [
    {
      name: "sb-access-token",
      value: "refreshed-access",
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
      priority: "high",
    },
    {
      name: "sb-refresh-token",
      value: "refreshed-refresh",
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: "/auth",
      expires: new Date("2030-01-01T00:00:00.000Z"),
      partitioned: true,
      domain: "example.test",
    },
  ];

  for (const destination of ["/login", "/change-password", "/"] as const) {
    it(`retains full cookie attributes for redirect category ${destination}`, () => {
      const written: SessionResponseCookie[] = [];
      copySessionCookiesOnto(
        { getAll: () => sampleCookies },
        {
          set: (cookie) => {
            written.push(cookie);
          },
        },
      );

      assert.equal(written.length, 2);
      assert.deepEqual(written[0], sampleCookies[0]);
      assert.deepEqual(written[1], sampleCookies[1]);

      // Fail if a name/value-only copy discarded security attributes.
      assert.equal(written[0]?.httpOnly, true);
      assert.equal(written[0]?.secure, true);
      assert.equal(written[0]?.sameSite, "lax");
      assert.equal(written[0]?.path, "/");
      assert.equal(written[0]?.maxAge, 3600);
      assert.equal(written[1]?.expires instanceof Date, true);
      assert.equal(written[1]?.partitioned, true);
      assert.equal(written[1]?.domain, "example.test");
      void destination;
    });
  }

  it("copies multiple response cookies independently with attributes", () => {
    const written: SessionResponseCookie[] = [];
    copySessionCookiesOnto(
      { getAll: () => sampleCookies },
      {
        set: (cookie) => {
          written.push({ ...cookie });
        },
      },
    );
    assert.equal(written[0]?.name, "sb-access-token");
    assert.equal(written[0]?.value, "refreshed-access");
    assert.equal(written[0]?.httpOnly, true);
    assert.equal(written[0]?.secure, true);
    assert.equal(written[0]?.sameSite, "lax");
    assert.equal(written[0]?.path, "/");
    assert.equal(written[0]?.maxAge, 3600);

    assert.equal(written[1]?.name, "sb-refresh-token");
    assert.equal(written[1]?.value, "refreshed-refresh");
    assert.equal(written[1]?.httpOnly, true);
    assert.equal(written[1]?.secure, true);
    assert.equal(written[1]?.sameSite, "strict");
    assert.equal(written[1]?.path, "/auth");
    assert.equal(written[1]?.expires instanceof Date, true);
    assert.equal(written[1]?.partitioned, true);
  });

  it("fails closed if only name and value were forwarded", () => {
    // Simulate a broken writer that strips attributes — the helper must still
    // hand the full object to set(); this assertion documents the contract.
    let received: SessionResponseCookie | undefined;
    copySessionCookiesOnto(
      {
        getAll: () => [
          {
            name: "sb-access-token",
            value: "v",
            httpOnly: true,
            secure: true,
            sameSite: "lax",
            path: "/",
            maxAge: 60,
          },
        ],
      },
      {
        set: (cookie) => {
          received = cookie;
        },
      },
    );
    assert.ok(received);
    const keys = Object.keys(received!);
    assert.ok(keys.includes("httpOnly"));
    assert.ok(keys.includes("secure"));
    assert.ok(keys.includes("sameSite"));
    assert.ok(keys.includes("path"));
    assert.ok(keys.includes("maxAge"));
    assert.notDeepEqual(keys.sort(), ["name", "value"].sort());
  });

  it("copies response cookies, not request cookies", () => {
    const written: SessionResponseCookie[] = [];
    copySessionCookiesOnto(
      {
        getAll: () => [
          {
            name: "sb-access-token",
            value: "from-response",
            httpOnly: true,
            path: "/",
          },
        ],
      },
      {
        set: (cookie) => {
          written.push(cookie);
        },
      },
    );
    assert.equal(written[0]?.value, "from-response");
    assert.equal(written[0]?.httpOnly, true);
    assert.equal(
      written.some((cookie) => cookie.name === "request-only"),
      false,
    );
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
