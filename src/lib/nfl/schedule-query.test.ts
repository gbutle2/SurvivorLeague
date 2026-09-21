import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildPickGameOptions,
  isExistingPickLocked,
} from "./schedule-query.ts";

const thursdayKickoff = "2026-09-17T00:15:00.000Z"; // Thu night
const sundayKickoff = "2026-09-20T17:00:00.000Z";
const afterThursday = new Date("2026-09-18T12:00:00.000Z");
const beforeSunday = new Date("2026-09-20T16:00:00.000Z");

function sampleGames() {
  return [
    {
      id: "g-thu",
      home_team_id: "kc",
      away_team_id: "buf",
      scheduled_kickoff_at: thursdayKickoff,
      status: "scheduled",
      home: {
        id: "kc",
        abbreviation: "KC",
        city: "Kansas City",
        name: "Chiefs",
      },
      away: {
        id: "buf",
        abbreviation: "BUF",
        city: "Buffalo",
        name: "Bills",
      },
    },
    {
      id: "g-sun",
      home_team_id: "det",
      away_team_id: "phi",
      scheduled_kickoff_at: sundayKickoff,
      status: "scheduled",
      home: {
        id: "det",
        abbreviation: "DET",
        city: "Detroit",
        name: "Lions",
      },
      away: {
        id: "phi",
        abbreviation: "PHI",
        city: "Philadelphia",
        name: "Eagles",
      },
    },
  ];
}

describe("buildPickGameOptions lock rules", () => {
  it("locks kicked-off games and leaves later scheduled games unlocked", () => {
    const options = buildPickGameOptions({
      games: sampleGames(),
      usedTeamIds: new Set(),
      now: afterThursday,
    });
    const kc = options.find((o) => o.teamId === "kc");
    const det = options.find((o) => o.teamId === "det");
    assert.equal(kc?.locked, true);
    assert.equal(det?.locked, false);
  });

  it("keeps postponed games with future kickoff unlocked", () => {
    const games = sampleGames();
    games[1] = { ...games[1], status: "postponed" };
    const options = buildPickGameOptions({
      games,
      usedTeamIds: new Set(),
      now: afterThursday,
    });
    assert.equal(options.find((o) => o.teamId === "det")?.locked, false);
  });

  it("locks postponed games once kickoff has passed", () => {
    const games = [
      {
        ...sampleGames()[1],
        status: "postponed",
        scheduled_kickoff_at: thursdayKickoff,
      },
    ];
    const options = buildPickGameOptions({
      games,
      usedTeamIds: new Set(),
      now: afterThursday,
    });
    assert.equal(options.find((o) => o.teamId === "det")?.locked, true);
  });

  it("locks final and in_progress games even with a future kickoff timestamp", () => {
    const games = [
      {
        ...sampleGames()[1],
        status: "final",
        scheduled_kickoff_at: sundayKickoff,
      },
    ];
    const options = buildPickGameOptions({
      games,
      usedTeamIds: new Set(),
      now: afterThursday,
    });
    assert.equal(options.every((o) => o.locked), true);
  });
});

describe("isExistingPickLocked", () => {
  it("locks when the authoritative game has kicked off", () => {
    assert.equal(
      isExistingPickLocked({
        selectedTeamId: "kc",
        selectedGame: {
          status: "scheduled",
          scheduled_kickoff_at: thursdayKickoff,
        },
        gameUnresolved: false,
        nowMs: afterThursday.getTime(),
      }),
      true,
    );
  });

  it("allows edits when the authoritative Sunday game has not kicked off", () => {
    assert.equal(
      isExistingPickLocked({
        selectedTeamId: "det",
        selectedGame: {
          status: "scheduled",
          scheduled_kickoff_at: sundayKickoff,
        },
        gameUnresolved: false,
        nowMs: beforeSunday.getTime(),
      }),
      false,
    );
  });

  it("does not lock when there is no existing pick", () => {
    assert.equal(
      isExistingPickLocked({ selectedTeamId: null }),
      false,
    );
  });

  it("treats unresolved picks without game metadata as non-editable", () => {
    assert.equal(
      isExistingPickLocked({
        selectedTeamId: "gone",
        options: [],
        gameUnresolved: true,
        nowMs: afterThursday.getTime(),
      }),
      true,
    );
  });

  it("locks via selectedGame when the option is missing and kickoff passed", () => {
    assert.equal(
      isExistingPickLocked({
        selectedTeamId: "gone",
        options: [],
        selectedGame: {
          status: "scheduled",
          scheduled_kickoff_at: thursdayKickoff,
        },
        gameUnresolved: false,
        nowMs: afterThursday.getTime(),
      }),
      true,
    );
  });

  it("allows edits when selectedGame is future even if options omit the team", () => {
    assert.equal(
      isExistingPickLocked({
        selectedTeamId: "det",
        options: [],
        selectedGame: {
          status: "scheduled",
          scheduled_kickoff_at: sundayKickoff,
        },
        gameUnresolved: false,
        nowMs: beforeSunday.getTime(),
      }),
      false,
    );
  });
});

describe("retainTeamId", () => {
  it("keeps the current-week team selectable even if listed in usedTeamIds", () => {
    const options = buildPickGameOptions({
      games: sampleGames(),
      usedTeamIds: new Set(["det", "kc"]),
      retainTeamId: "det",
      now: beforeSunday,
    });
    assert.equal(options.find((o) => o.teamId === "det")?.used, false);
    assert.equal(options.find((o) => o.teamId === "kc")?.used, true);
  });
});
