import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMMISSIONER_UPDATE_ZERO_ROW,
  PICK_UPDATE_ZERO_ROW,
  requireMutationRow,
  SEASON_ACTIVATION_ZERO_ROW,
} from "./result.ts";

describe("requireMutationRow", () => {
  it("does not report pick-update zero-row as saved", () => {
    const result = requireMutationRow(null, PICK_UPDATE_ZERO_ROW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, PICK_UPDATE_ZERO_ROW);
      assert.doesNotMatch(result.error, /saved/i);
    }
  });

  it("does not report activation zero-row as success", () => {
    const result = requireMutationRow(null, SEASON_ACTIVATION_ZERO_ROW);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error, SEASON_ACTIVATION_ZERO_ROW);
    }
  });

  it("returns the row when present", () => {
    const result = requireMutationRow(
      { id: "1" },
      COMMISSIONER_UPDATE_ZERO_ROW,
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.row.id, "1");
    }
  });
});
