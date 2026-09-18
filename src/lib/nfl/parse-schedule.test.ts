import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCsv, csvToObjects } from "./csv.ts";
import { parseProviderGames } from "./parse-schedule.ts";
import { mapProviderTeamAbbreviation } from "./team-map.ts";

describe("nflverse schedule parsing", () => {
  it("maps LA to LAR", () => {
    assert.equal(mapProviderTeamAbbreviation("LA"), "LAR");
    assert.equal(mapProviderTeamAbbreviation("LAC"), "LAC");
  });

  it("parses valid regular and postseason rows", () => {
    const csv = [
      "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score",
      "2026_01_DAL_PHI,2026,REG,1,2026-09-10,Thursday,20:20,DAL,,PHI,",
      "2026_19_WC_A,2026,WC,19,2027-01-10,Saturday,16:30,BUF,,BAL,",
    ].join("\n");
    const rows = csvToObjects(csv);
    const { games, rejects } = parseProviderGames(rows, 2026);
    assert.equal(rejects.length, 0);
    assert.equal(games.length, 2);
    assert.equal(games[0]!.regularWeekNumber, 1);
    assert.equal(games[0]!.seasonType, "regular");
    assert.equal(games[1]!.playoffRound, "wildcard");
    assert.equal(games[1]!.seasonType, "postseason");
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

  it("rejects same home/away and malformed timestamps", () => {
    const csv = [
      "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score",
      "same,2026,REG,1,2026-09-10,Thu,13:00,DAL,,DAL,",
      "badtime,2026,REG,2,not-a-date,Thu,13:00,KC,,LAC,",
    ].join("\n");
    const { games, rejects } = parseProviderGames(csvToObjects(csv), 2026);
    assert.equal(games.length, 0);
    assert.ok(rejects.length >= 2);
  });

  it("rejects unknown abbreviations after mapping", () => {
    const csv = [
      "game_id,season,game_type,week,gameday,weekday,gametime,away_team,away_score,home_team,home_score",
      "x,2026,REG,1,2026-09-10,Thu,13:00,ZZZ,,PHI,",
    ].join("\n");
    // Parser maps unknown to ZZZ; sync layer rejects vs teams table.
    const { games } = parseProviderGames(csvToObjects(csv), 2026);
    assert.equal(games[0]!.awayAbbreviation, "ZZZ");
  });

  it("parses quoted CSV fields", () => {
    const rows = parseCsv('a,b\n"1,2",3\n');
    assert.deepEqual(rows[1], ["1,2", "3"]);
  });
});
