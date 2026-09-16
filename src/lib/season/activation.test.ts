import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activationBlockedReason,
  interpretSeasonActivationRow,
  setupSeasonBlocksPicks,
} from "./activation.ts";

describe("setupSeasonBlocksPicks", () => {
  it("blocks player picks while the season is in setup", () => {
    assert.equal(setupSeasonBlocksPicks("setup"), true);
    assert.equal(setupSeasonBlocksPicks("active"), false);
  });
});

describe("activationBlockedReason", () => {
  it("allows activation when setup, scoring rules, and a week exist", () => {
    assert.equal(
      activationBlockedReason({
        status: "setup",
        hasScoringRules: true,
        weekCount: 1,
      }),
      null,
    );
  });

  it("requires scoring rules and at least one week", () => {
    assert.match(
      activationBlockedReason({
        status: "setup",
        hasScoringRules: false,
        weekCount: 1,
      }) ?? "",
      /scoring rules/i,
    );
    assert.match(
      activationBlockedReason({
        status: "setup",
        hasScoringRules: true,
        weekCount: 0,
      }) ?? "",
      /at least one week/i,
    );
  });
});

describe("interpretSeasonActivationRow", () => {
  it("treats a null row as failure, not success", () => {
    const result = interpretSeasonActivationRow(null);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /not activated/i);
    }
  });

  it("accepts an active row as success", () => {
    const result = interpretSeasonActivationRow({
      id: "season-1",
      status: "active",
    });
    assert.equal(result.ok, true);
  });
});
