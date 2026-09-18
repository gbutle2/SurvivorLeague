import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { shouldDeleteAuthUserOnCompensation } from "./policy.ts";

describe("partial-failure compensation behavior", () => {
  it("never deletes a pre-existing Auth user", () => {
    assert.equal(
      shouldDeleteAuthUserOnCompensation({
        newlyCreatedInThisRequest: false,
        preExistingUser: true,
      }),
      false,
    );
  });

  it("deletes only a user created in the failed request", () => {
    assert.equal(
      shouldDeleteAuthUserOnCompensation({
        newlyCreatedInThisRequest: true,
        preExistingUser: false,
      }),
      true,
    );
  });
});
