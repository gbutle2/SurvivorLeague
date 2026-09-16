import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { mapPickMutationError, mapWeekMutationError } from "./errors.ts";

describe("mapPickMutationError", () => {
  it("maps reused-team errors", () => {
    assert.match(
      mapPickMutationError({
        message: "Team already used by this player in the same season",
        code: "23514",
      }),
      /already used/i,
    );
  });

  it("maps deadline / RLS lock errors", () => {
    assert.match(
      mapPickMutationError({
        message: "new row violates row-level security policy",
        code: "42501",
      }),
      /locked/i,
    );
  });
});

describe("mapWeekMutationError", () => {
  it("maps duplicate week numbers", () => {
    assert.match(
      mapWeekMutationError({
        message: 'duplicate key value violates unique constraint "weeks_unique_season_week"',
        code: "23505",
      }),
      /already exists/i,
    );
  });

  it("maps unauthorized week management", () => {
    assert.match(
      mapWeekMutationError({
        message: "new row violates row-level security policy",
        code: "42501",
      }),
      /not authorized/i,
    );
  });
});
