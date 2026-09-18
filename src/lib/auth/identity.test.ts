import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  authenticatedUserId,
  commissionerActionDenied,
} from "./identity.ts";

describe("authenticatedUserId", () => {
  it("never lets a submitted user_id override the session", () => {
    assert.equal(
      authenticatedUserId(
        "session-user",
        "attacker-user",
      ),
      "session-user",
    );
  });
});

describe("commissionerActionDenied", () => {
  it("blocks players from commissioner actions", () => {
    assert.match(commissionerActionDenied("player") ?? "", /commissioner/i);
  });

  it("allows commissioners", () => {
    assert.equal(commissionerActionDenied("commissioner"), null);
  });

  it("unauthorized users cannot run commissioner calendar actions", () => {
    assert.equal(
      commissionerActionDenied("player"),
      "Only the commissioner can manage weeks.",
    );
    assert.equal(
      commissionerActionDenied(null),
      "Only the commissioner can manage weeks.",
    );
    assert.equal(
      commissionerActionDenied(undefined),
      "Only the commissioner can manage weeks.",
    );
  });
});
