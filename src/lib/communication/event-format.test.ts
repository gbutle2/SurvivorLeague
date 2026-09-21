import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatLeagueEvent } from "./event-format.ts";
import type { LeagueEventForFormat, TeamLookup } from "./types.ts";

const teams: TeamLookup = new Map([
  ["buf-id", "Bills"],
  ["bal-id", "Ravens"],
  ["BUF", "Bills"],
  ["BAL", "Ravens"],
]);

function event(
  partial: Partial<LeagueEventForFormat> &
    Pick<LeagueEventForFormat, "event_type">,
): LeagueEventForFormat {
  return {
    actor_display_name: "Geoff",
    affected_display_name: "Geoff",
    is_revealed: false,
    payload: {},
    ...partial,
  };
}

describe("formatLeagueEvent privacy", () => {
  it("omits team names before reveal for pick submitted/updated", () => {
    assert.equal(
      formatLeagueEvent(
        event({
          event_type: "pick_submitted",
          payload: { week_number: 4, team_id: "buf-id" },
          is_revealed: false,
        }),
        teams,
      ),
      "Geoff submitted a pick for Week 4.",
    );
    assert.equal(
      formatLeagueEvent(
        event({
          event_type: "pick_updated",
          payload: { week_number: 4, team_id: "buf-id" },
          is_revealed: false,
        }),
        teams,
      ),
      "Geoff updated their pick for Week 4.",
    );
    const text = formatLeagueEvent(
      event({
        event_type: "pick_submitted",
        payload: { week_number: 4, team_id: "buf-id" },
        is_revealed: false,
      }),
      teams,
    );
    assert.doesNotMatch(text, /Bills|buf-id|BUF/i);
  });

  it("omits team names before reveal for commissioner changes", () => {
    assert.equal(
      formatLeagueEvent(
        event({
          event_type: "commissioner_pick_changed",
          affected_display_name: "Geoff",
          payload: {
            week_number: 4,
            team_id: "bal-id",
            previous_team_id: "buf-id",
          },
          is_revealed: false,
        }),
        teams,
      ),
      "Commissioner updated Geoff's pick for Week 4.",
    );
  });

  it("includes nicknames after reveal", () => {
    assert.equal(
      formatLeagueEvent(
        event({
          event_type: "pick_submitted",
          payload: { week_number: 4, team_id: "buf-id" },
          is_revealed: true,
        }),
        teams,
      ),
      "Geoff picked the Bills for Week 4.",
    );
    assert.equal(
      formatLeagueEvent(
        event({
          event_type: "commissioner_pick_changed",
          affected_display_name: "Geoff",
          payload: {
            week_number: 4,
            team_id: "bal-id",
            previous_team_id: "buf-id",
          },
          is_revealed: true,
        }),
        teams,
      ),
      "Commissioner changed Geoff's Week 4 pick from the Bills to the Ravens.",
    );
  });
});

describe("formatLeagueEvent other types", () => {
  it("formats week, survivor, and membership events", () => {
    assert.equal(
      formatLeagueEvent(
        event({
          event_type: "week_opened",
          payload: { week_number: 4 },
          is_revealed: true,
        }),
      ),
      "Week 4 is now open for picks.",
    );
    assert.equal(
      formatLeagueEvent(
        event({
          event_type: "week_locked",
          payload: { week_number: 4 },
          is_revealed: true,
        }),
      ),
      "Week 4 picks are locked.",
    );
    assert.equal(
      formatLeagueEvent(
        event({
          event_type: "survivor_eliminated",
          affected_display_name: "Geoff",
          is_revealed: true,
        }),
      ),
      "Geoff was eliminated from Survivor.",
    );
    assert.equal(
      formatLeagueEvent(
        event({
          event_type: "member_added",
          affected_display_name: "Alex",
          is_revealed: true,
        }),
      ),
      "Alex joined the league.",
    );
  });
});
