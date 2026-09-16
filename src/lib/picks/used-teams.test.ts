import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { usedTeamIds, teamAvailabilityStatus } from "./used-teams.ts";

describe("usedTeamIds", () => {
  it("collects used teams across weeks", () => {
    const used = usedTeamIds([
      { week_id: "w1", team_id: "t1" },
      { week_id: "w2", team_id: "t2" },
    ]);
    assert.deepEqual([...used].sort(), ["t1", "t2"]);
  });

  it("excludes the current week when changing the same pick", () => {
    const used = usedTeamIds(
      [
        { week_id: "w1", team_id: "t1" },
        { week_id: "w2", team_id: "t2" },
      ],
      { excludeWeekId: "w2" },
    );
    assert.deepEqual([...used], ["t1"]);
    assert.equal(teamAvailabilityStatus("t2", used, "t2"), "CURRENT");
    assert.equal(teamAvailabilityStatus("t1", used, "t2"), "USED");
    assert.equal(teamAvailabilityStatus("t3", used, "t2"), "AVAILABLE");
  });
});
