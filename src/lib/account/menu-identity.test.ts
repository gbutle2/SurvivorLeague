import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  accountInitials,
  accountMenuTriggerAria,
  accountTriggerLabel,
  reduceAccountMenuUi,
  resolveMenuTargetUserId,
} from "./menu-identity.ts";
import { resolveForcedPasswordRedirect } from "../supabase/auth-routing.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("account menu identity helpers", () => {
  it("builds multi-word and single-word initials", () => {
    assert.equal(accountInitials("Jane Doe"), "JD");
    assert.equal(accountInitials("  mary   anne  smith "), "MS");
    assert.equal(accountInitials("Geoff"), "G");
    assert.equal(accountInitials("gbutle2"), "G");
  });

  it("returns null for missing names so the UI can fall back to a person icon", () => {
    assert.equal(accountInitials(null), null);
    assert.equal(accountInitials(""), null);
    assert.equal(accountInitials("   "), null);
    assert.equal(accountTriggerLabel(null), null);
    assert.equal(accountTriggerLabel("  Ada "), "Ada");
  });

  it("ignores submitted user ids when resolving the menu target", () => {
    assert.equal(
      resolveMenuTargetUserId("session-user", "attacker"),
      "session-user",
    );
  });
});

describe("account menu interaction state", () => {
  it("toggles open and closes on escape, outside click, and selection", () => {
    let state = { open: false };
    state = reduceAccountMenuUi(state, { type: "toggle" });
    assert.equal(state.open, true);
    state = reduceAccountMenuUi(state, { type: "escape" });
    assert.equal(state.open, false);
    state = reduceAccountMenuUi(state, { type: "open" });
    assert.equal(state.open, true);
    state = reduceAccountMenuUi(state, { type: "outside" });
    assert.equal(state.open, false);
    state = reduceAccountMenuUi(state, { type: "open" });
    state = reduceAccountMenuUi(state, { type: "select" });
    assert.equal(state.open, false);
  });

  it("exposes correct accessibility attributes for open and closed states", () => {
    assert.deepEqual(accountMenuTriggerAria(false), {
      "aria-expanded": false,
      "aria-haspopup": "menu",
      "aria-label": "Open account menu",
    });
    assert.deepEqual(accountMenuTriggerAria(true), {
      "aria-expanded": true,
      "aria-haspopup": "menu",
      "aria-label": "Open account menu",
    });
  });
});

describe("account menu shell wiring", () => {
  it("places a shared account menu in AppShell and the dashboard header", () => {
    const shell = readFileSync(
      path.join(ROOT, "components/app-shell.tsx"),
      "utf8",
    );
    const dashboard = readFileSync(path.join(ROOT, "app/page.tsx"), "utf8");
    const menu = readFileSync(
      path.join(ROOT, "components/account-menu.tsx"),
      "utf8",
    );
    const header = readFileSync(
      path.join(ROOT, "components/account-menu-header.tsx"),
      "utf8",
    );

    assert.match(shell, /AccountMenuHeader/);
    assert.match(dashboard, /AccountMenuHeader/);
    assert.doesNotMatch(dashboard, /LogoutButton/);
    assert.doesNotMatch(
      dashboard,
      /title=\"Account\"[\s\S]*href=\"\/account\"/,
    );
    assert.match(menu, /href=\"\/account\"/);
    assert.match(menu, /Account settings/);
    assert.match(menu, /action=\{logout\}/);
    assert.match(menu, /Log out/);
    assert.match(header, /loadAccountMenuIdentity/);
    assert.doesNotMatch(header, /createAdminClient|SERVICE_ROLE/);
    assert.doesNotMatch(menu, /createAdminClient|SERVICE_ROLE/);
  });

  it("keeps login free of the account menu and change-password on LogoutButton only", () => {
    const login = readFileSync(path.join(ROOT, "app/login/page.tsx"), "utf8");
    const loginForm = readFileSync(
      path.join(ROOT, "app/login/login-form.tsx"),
      "utf8",
    );
    const changePassword = readFileSync(
      path.join(ROOT, "app/change-password/page.tsx"),
      "utf8",
    );

    assert.doesNotMatch(login, /AccountMenu/);
    assert.doesNotMatch(loginForm, /AccountMenu/);
    assert.match(changePassword, /LogoutButton/);
    assert.doesNotMatch(changePassword, /AccountMenu/);
  });

  it("keeps forced-password users off /account via routing", () => {
    assert.equal(
      resolveForcedPasswordRedirect({
        authenticated: true,
        mustChangePassword: true,
        pathname: "/account",
      }),
      "/change-password",
    );
  });

  it("does not duplicate AccountMenuHeader across leaf pages that use AppShell", () => {
    for (const relative of [
      "app/pick/page.tsx",
      "app/history/page.tsx",
      "app/availability/page.tsx",
      "app/rules/page.tsx",
      "app/commissioner/page.tsx",
      "app/account/page.tsx",
    ]) {
      const source = readFileSync(path.join(ROOT, relative), "utf8");
      assert.doesNotMatch(source, /AccountMenuHeader/);
      assert.match(source, /AppShell/);
    }
  });
});
