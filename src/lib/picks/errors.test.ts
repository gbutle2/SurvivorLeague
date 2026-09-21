import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mapOpenWeekUniqueViolation,
  mapPickMutationError,
  mapWeekMutationError,
} from "./errors.ts";

describe("mapPickMutationError", () => {
  it("maps reused-team errors with the conflict week when known", () => {
    assert.equal(
      mapPickMutationError(
        {
          message: "Team already used by this player in the same season",
          code: "23514",
        },
        { conflictWeekNumber: 2 },
      ),
      "You already used this team in Week 2.",
    );
  });

  it("maps kickoff unlock failures precisely", () => {
    assert.equal(
      mapPickMutationError({
        message: "pick_team_plays_unlocked_in_week failed: kickoff passed",
      }),
      "Your pick is locked because this game has started.",
    );
  });

  it("does not claim kickoff passed for generic RLS failures", () => {
    const message = mapPickMutationError({
      message: "new row violates row-level security policy",
      code: "42501",
    });
    assert.match(message, /refresh and try again/i);
    assert.doesNotMatch(message, /kickoff/i);
    assert.doesNotMatch(message, /locked or not selectable/i);
  });

  it("maps closed-week failures", () => {
    assert.equal(
      mapPickMutationError(
        { message: "week_allows_player_picks returned false" },
        { weekLabel: "Week 4" },
      ),
      "Week 4 is closed for picks.",
    );
  });

  it("maps unscheduled team failures", () => {
    assert.equal(
      mapPickMutationError(
        { message: "no scheduled game / bye" },
        { weekNumber: 3 },
      ),
      "This team is not scheduled for Week 3.",
    );
  });

  it("maps concurrent pick conflicts", () => {
    assert.match(
      mapPickMutationError({
        message: 'duplicate key value violates unique constraint "picks_unique_week_user"',
        code: "23505",
      }),
      /refresh and try again/i,
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

  it("maps the one-open-week unique index violation", () => {
    assert.match(
      mapWeekMutationError({
        message:
          'duplicate key value violates unique constraint "weeks_one_open_per_season_idx"',
        code: "23505",
      }),
      /another week is already open/i,
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

describe("mapOpenWeekUniqueViolation", () => {
  it("provides friendly handling of the unique-index violation", () => {
    assert.equal(
      mapOpenWeekUniqueViolation({
        code: "23505",
        message:
          'duplicate key value violates unique constraint "weeks_one_open_per_season_idx"',
      }),
      "Another week is already open. Lock it before opening this week.",
    );
  });
});
