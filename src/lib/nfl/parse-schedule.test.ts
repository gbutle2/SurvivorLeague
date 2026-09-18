import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatCentralDateTime } from "../time/chicago.ts";
import {
  easternWallTimeToUtc,
  easternWallTimeToUtcIso,
} from "../time/eastern.ts";
import { csvToObjects } from "./csv.ts";
import {
  kickoffIsoFromProvider,
  parseProviderGames,
} from "./parse-schedule.ts";
import { mapProviderTeamAbbreviation } from "./team-map.ts";

describe("nflverse Eastern kickoff conversion", () => {
  it("converts an EDT kickoff correctly (UTC-4)", () => {
    // 2025-09-04 20:20 America/New_York (EDT) → 2025-09-05T00:20:00.000Z
    const utc = easternWallTimeToUtc("2025-09-04", "20:20");
    assert.equal(utc.toISOString(), "2025-09-05T00:20:00.000Z");
  });

  it("converts an EST kickoff correctly (UTC-5)", () => {
    // 2025-12-21 13:00 America/New_York (EST) → 2025-12-21T18:00:00.000Z
    const utc = easternWallTimeToUtc("2025-12-21", "13:00");
    assert.equal(utc.toISOString(), "2025-12-21T18:00:00.000Z");
  });

  it("does not lock one hour late vs Chicago misinterpretation", () => {
    // If wrongly treated as Central, 13:00 CT = 18:00Z in CDT;
    // correct Eastern 13:00 EDT = 17:00Z — one hour earlier.
    const correct = easternWallTimeToUtcIso("2025-09-14", "13:00");
    assert.equal(correct, "2025-09-14T17:00:00.000Z");
    // A Chicago mis-parse of the same wall clock would be 18:00Z in CDT.
    assert.notEqual(correct, "2025-09-14T18:00:00.000Z");
  });

  it("formats stored UTC instants in Central Time for UI", () => {
    const label = formatCentralDateTime("2025-09-14T17:00:00.000Z");
    assert.match(label, /Sep 14/);
    assert.match(label, /12:00|CDT|CST/);
  });

  it("rejects missing or malformed gametime instead of midnight", () => {
    const missing = kickoffIsoFromProvider("2025-09-14", "");
    assert.equal(missing.ok, false);
    const bad = kickoffIsoFromProvider("2025-09-14", "TBD");
    assert.equal(bad.ok, false);
  });
});

describe("nflverse schedule parsing", () => {
  it("maps LA to LAR", () => {
    assert.equal(mapProviderTeamAbbreviation("LA"), "LAR");
    assert.equal(mapProviderTeamAbbreviation("LAC"), "LAC");
  });

  it("parses valid regular and postseason rows using Eastern kickoffs", () => {
    const csv = [
      "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score",
      "2026_01_DAL_PHI,2026,REG,1,2026-09-10,Thursday,20:20,DAL,,PHI,",
      "2026_19_WC_A,2026,WC,19,2027-01-10,Saturday,16:30,BUF,,BAL,",
    ].join("\n");
    const rows = csvToObjects(csv);
    const { games, rejects } = parseProviderGames(rows, 2026);
    assert.equal(rejects.length, 0);
    assert.equal(games.length, 2);
    assert.equal(games[0]!.scheduledKickoffAt, "2026-09-11T00:20:00.000Z");
    assert.equal(games[1]!.playoffRound, "wildcard");
  });

  it("rejects duplicate provider game ids", () => {
    const csv = [
      "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score",
      "dup,2026,REG,1,2026-09-10,Thu,13:00,DAL,,PHI,",
      "dup,2026,REG,1,2026-09-10,Thu,13:00,KC,,LAC,",
    ].join("\n");
    const { rejects } = parseProviderGames(csvToObjects(csv), 2026);
    assert.ok(rejects.some((r) => r.reason.includes("Duplicate")));
  });

  it("rejects same home/away and missing gametime", () => {
    const csv = [
      "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score",
      "same,2026,REG,1,2026-09-10,Thu,13:00,DAL,,DAL,",
      "notime,2026,REG,2,2026-09-17,Thu,,KC,,LAC,",
    ].join("\n");
    const { games, rejects } = parseProviderGames(csvToObjects(csv), 2026);
    assert.equal(games.length, 0);
    assert.ok(rejects.some((r) => /gametime/i.test(r.reason)));
  });
});
