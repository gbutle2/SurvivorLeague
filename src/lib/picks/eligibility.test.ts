import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultPickEditorExpanded,
  formatPickDeadlineLine,
  isExistingPickLocked,
  isGameUnlocked,
  resolvePickEditorMode,
} from "./eligibility.ts";
import { buildPickGameOptions } from "../nfl/schedule-query.ts";

const futureKickoff = "2026-09-27T20:05:00.000Z"; // Sun Sep 27 ~3:05 PM CT
const pastKickoff = "2026-09-18T00:15:00.000Z";
const nowBeforeFuture = Date.parse("2026-09-21T21:00:00.000Z"); // Mon Sep 21
const nowAfterPast = Date.parse("2026-09-18T12:00:00.000Z");

const sfGame = {
  id: "g-sf",
  home_team_id: "sf",
  away_team_id: "lar",
  scheduled_kickoff_at: futureKickoff,
  status: "scheduled",
  home: {
    id: "sf",
    abbreviation: "SF",
    city: "San Francisco",
    name: "49ers",
  },
  away: {
    id: "lar",
    abbreviation: "LAR",
    city: "Los Angeles",
    name: "Rams",
  },
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

describe("isExistingPickLocked", () => {
  it("keeps a future SF pick unlocked on the Monday before kickoff", () => {
    const options = buildPickGameOptions({
      games: [sfGame],
      usedTeamIds: new Set(),
      retainTeamId: "sf",
      now: new Date(nowBeforeFuture),
    });
    assert.equal(
      isExistingPickLocked({
        selectedTeamId: "sf",
        options,
        nowMs: nowBeforeFuture,
      }),
      false,
    );
  });

  it("locks a past-kickoff pick using the option timestamp", () => {
    const options = buildPickGameOptions({
      games: [{ ...sfGame, scheduled_kickoff_at: pastKickoff }],
      usedTeamIds: new Set(),
      now: new Date(nowAfterPast),
    });
    assert.equal(
      isExistingPickLocked({
        selectedTeamId: "sf",
        options,
        nowMs: nowAfterPast,
      }),
      true,
    );
  });

  it("does not treat a missing option as kickoff-passed", () => {
    const options = buildPickGameOptions({
      games: [sfGame],
      usedTeamIds: new Set(),
      now: new Date(nowBeforeFuture),
    });
    assert.equal(
      isExistingPickLocked({
        selectedTeamId: "gone",
        options,
        nowMs: nowBeforeFuture,
      }),
      false,
    );
  });

  it("uses authoritative selectedGame when the option is absent", () => {
    assert.equal(
      isExistingPickLocked({
        selectedTeamId: "sf",
        options: [],
        selectedGame: {
          status: "scheduled",
          scheduled_kickoff_at: pastKickoff,
        },
        nowMs: nowAfterPast,
      }),
      true,
    );
    assert.equal(
      isExistingPickLocked({
        selectedTeamId: "sf",
        options: [],
        selectedGame: {
          status: "scheduled",
          scheduled_kickoff_at: futureKickoff,
        },
        nowMs: nowBeforeFuture,
      }),
      false,
    );
  });

  it("distinguishes missing option from passed kickoff", () => {
    const missing = isExistingPickLocked({
      selectedTeamId: "missing",
      options: [],
      nowMs: nowBeforeFuture,
    });
    const passed = isExistingPickLocked({
      selectedTeamId: "sf",
      options: [],
      selectedGame: {
        status: "scheduled",
        scheduled_kickoff_at: pastKickoff,
      },
      nowMs: nowAfterPast,
    });
    assert.equal(missing, false);
    assert.equal(passed, true);
  });
});

describe("retainTeamId / reuse filtering", () => {
  it("does not mark the current-week team as used against itself", () => {
    const options = buildPickGameOptions({
      games: [sfGame],
      usedTeamIds: new Set(["sf", "kc"]),
      retainTeamId: "sf",
      now: new Date(nowBeforeFuture),
    });
    const sf = options.find((o) => o.teamId === "sf");
    assert.equal(sf?.used, false);
  });

  it("keeps teams used in other weeks unavailable", () => {
    const options = buildPickGameOptions({
      games: [sfGame],
      usedTeamIds: new Set(["lar"]),
      retainTeamId: "sf",
      now: new Date(nowBeforeFuture),
    });
    assert.equal(options.find((o) => o.teamId === "lar")?.used, true);
    assert.equal(options.find((o) => o.teamId === "sf")?.used, false);
  });
});

describe("pick editor expand defaults", () => {
  it("defaults existing editable picks to collapsed", () => {
    assert.equal(
      defaultPickEditorExpanded(
        resolvePickEditorMode({
          hasExistingPick: true,
          existingPickLocked: false,
          noEligibleGames: false,
        }),
      ),
      false,
    );
  });

  it("defaults locked/final picks to collapsed", () => {
    assert.equal(
      defaultPickEditorExpanded(
        resolvePickEditorMode({
          hasExistingPick: true,
          existingPickLocked: true,
          noEligibleGames: false,
        }),
      ),
      false,
    );
  });

  it("defaults no-pick to expanded", () => {
    assert.equal(
      defaultPickEditorExpanded(
        resolvePickEditorMode({
          hasExistingPick: false,
          existingPickLocked: false,
          noEligibleGames: false,
        }),
      ),
      true,
    );
  });

  it("defaults unavailable schedule to collapsed informational mode", () => {
    const mode = resolvePickEditorMode({
      hasExistingPick: false,
      existingPickLocked: false,
      noEligibleGames: true,
      scheduleUnavailable: true,
    });
    assert.equal(mode, "unavailable");
    assert.equal(defaultPickEditorExpanded(mode), false);
  });
});

describe("formatPickDeadlineLine", () => {
  it("uses a single editable/locked line without duplicating kickoff copy", () => {
    const formatKickoff = () => "Sun, Sep 27 at 3:05 PM CDT";
    assert.equal(
      formatPickDeadlineLine({
        locked: false,
        kickoffAt: futureKickoff,
        formatKickoff,
      }),
      "Editable until Sun, Sep 27 at 3:05 PM CDT",
    );
    assert.equal(
      formatPickDeadlineLine({
        locked: true,
        kickoffAt: futureKickoff,
        formatKickoff,
      }),
      "Locked at kickoff · Sun, Sep 27 at 3:05 PM CDT",
    );
  });
});
