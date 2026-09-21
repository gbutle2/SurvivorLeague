import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultPickEditorExpanded,
  formatPickDeadlineLine,
  isGameUnlocked,
  resolveAuthoritativePickGame,
  resolveExistingPickLockState,
  resolvePickEditorMode,
} from "./eligibility.ts";

const futureKickoff = "2026-09-27T20:05:00.000Z"; // Sun Sep 27 ~3:05 PM CT
const pastKickoff = "2026-09-18T00:15:00.000Z";
const nowBeforeFuture = Date.parse("2026-09-21T21:00:00.000Z"); // Mon Sep 21
const nowAfterPast = Date.parse("2026-09-18T12:00:00.000Z");

const sfGame = {
  id: "g-sf",
  status: "scheduled",
  scheduled_kickoff_at: futureKickoff,
  home_team_id: "sf",
  away_team_id: "lar",
};

describe("isGameUnlocked", () => {
  it("compares kickoff timestamps, not display text", () => {
    assert.equal(
      isGameUnlocked({
        status: "scheduled",
        scheduledKickoffAt: futureKickoff,
        nowMs: nowBeforeFuture,
      }),
      true,
    );
    assert.equal(
      isGameUnlocked({
        status: "scheduled",
        scheduledKickoffAt: pastKickoff,
        nowMs: nowAfterPast,
      }),
      false,
    );
  });
});

describe("resolveAuthoritativePickGame", () => {
  it("prefers game_id over team matching", () => {
    const other = {
      id: "g-other",
      status: "scheduled",
      scheduled_kickoff_at: futureKickoff,
      home_team_id: "sf",
      away_team_id: "sea",
    };
    const resolved = resolveAuthoritativePickGame({
      pick: { team_id: "sf", game_id: "g-sf" },
      games: [other, sfGame],
    });
    assert.equal(resolved.game?.id, "g-sf");
    assert.equal(resolved.unresolved, false);
  });

  it("marks unresolved when game_id is missing from the schedule load", () => {
    const resolved = resolveAuthoritativePickGame({
      pick: { team_id: "sf", game_id: "g-missing" },
      games: [sfGame],
    });
    assert.equal(resolved.game, null);
    assert.equal(resolved.unresolved, true);
  });

  it("falls back to team match for legacy null game_id", () => {
    const resolved = resolveAuthoritativePickGame({
      pick: { team_id: "sf", game_id: null },
      games: [sfGame],
    });
    assert.equal(resolved.game?.id, "g-sf");
    assert.equal(resolved.unresolved, false);
  });
});

describe("resolveExistingPickLockState", () => {
  it("returns editable for a future SF kickoff on Monday", () => {
    assert.equal(
      resolveExistingPickLockState({
        hasExistingPick: true,
        weekStatus: "open",
        authoritativeGame: sfGame,
        gameUnresolved: false,
        nowMs: nowBeforeFuture,
      }),
      "editable",
    );
  });

  it("returns locked after kickoff", () => {
    assert.equal(
      resolveExistingPickLockState({
        hasExistingPick: true,
        weekStatus: "open",
        authoritativeGame: { ...sfGame, scheduled_kickoff_at: pastKickoff },
        gameUnresolved: false,
        nowMs: nowAfterPast,
      }),
      "locked",
    );
  });

  it("returns locked when the week is closed", () => {
    assert.equal(
      resolveExistingPickLockState({
        hasExistingPick: true,
        weekStatus: "final",
        authoritativeGame: sfGame,
        gameUnresolved: false,
        nowMs: nowBeforeFuture,
      }),
      "locked",
    );
  });

  it("returns unavailable when the authoritative game cannot be resolved", () => {
    assert.equal(
      resolveExistingPickLockState({
        hasExistingPick: true,
        weekStatus: "open",
        authoritativeGame: null,
        gameUnresolved: true,
        nowMs: nowBeforeFuture,
      }),
      "unavailable",
    );
  });

  it("does not treat missing schedule as editable", () => {
    assert.notEqual(
      resolveExistingPickLockState({
        hasExistingPick: true,
        weekStatus: "open",
        authoritativeGame: null,
        gameUnresolved: true,
        nowMs: nowBeforeFuture,
      }),
      "editable",
    );
  });

  it("ignores filtered options — lock state uses authoritative game only", () => {
    // Even if options would omit SF, resolved game keeps editable.
    assert.equal(
      resolveExistingPickLockState({
        hasExistingPick: true,
        weekStatus: "open",
        authoritativeGame: sfGame,
        gameUnresolved: false,
        nowMs: nowBeforeFuture,
      }),
      "editable",
    );
  });
});

describe("pick editor modes", () => {
  it("maps unverified existing picks to unverified mode", () => {
    assert.equal(
      resolvePickEditorMode({
        hasExistingPick: true,
        existingPickState: "unavailable",
        noEligibleGames: false,
      }),
      "unverified",
    );
    assert.equal(
      defaultPickEditorExpanded("unverified"),
      false,
    );
  });

  it("defaults existing editable picks to collapsed", () => {
    assert.equal(
      defaultPickEditorExpanded(
        resolvePickEditorMode({
          hasExistingPick: true,
          existingPickState: "editable",
          noEligibleGames: false,
        }),
      ),
      false,
    );
  });
});

describe("formatPickDeadlineLine", () => {
  it("uses a single editable/locked line", () => {
    const formatKickoff = () => "Sun, Sep 27 at 3:05 PM CDT";
    assert.equal(
      formatPickDeadlineLine({
        locked: false,
        kickoffAt: futureKickoff,
        formatKickoff,
      }),
      "Editable until Sun, Sep 27 at 3:05 PM CDT",
    );
  });
});
