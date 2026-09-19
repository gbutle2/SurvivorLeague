import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  availabilityHidesTeam,
  buildAvailabilityGrid,
} from "./build-grid.ts";
import {
  buildAvailabilityMemberOptions,
  resolveAvailabilityMemberId,
  selectedMemberHeading,
} from "./member-options.ts";

describe("availability member selection", () => {
  it("defaults to the signed-in user and rejects unauthorized selections safely", () => {
    const active = new Set(["self", "peer"]);
    assert.equal(
      resolveAvailabilityMemberId({
        viewerId: "self",
        requestedId: null,
        activeMemberIds: active,
      }),
      "self",
    );
    assert.equal(
      resolveAvailabilityMemberId({
        viewerId: "self",
        requestedId: "peer",
        activeMemberIds: active,
      }),
      "peer",
    );
    assert.equal(
      resolveAvailabilityMemberId({
        viewerId: "self",
        requestedId: "outsider",
        activeMemberIds: active,
      }),
      "self",
    );
    assert.equal(
      resolveAvailabilityMemberId({
        viewerId: "self",
        requestedId: "not-a-uuid",
        activeMemberIds: active,
      }),
      "self",
    );
  });

  it("lists the signed-in user first as You and sorts the rest by display name", () => {
    const options = buildAvailabilityMemberOptions({
      viewerId: "u-self",
      members: [
        { userId: "u-b", displayName: "Blake" },
        { userId: "u-self", displayName: "Ada" },
        { userId: "u-a", displayName: "Casey" },
        { userId: "u-inactive-ignored-by-caller", displayName: "Zed" },
      ],
    });
    assert.equal(options[0]?.userId, "u-self");
    assert.match(options[0]?.label ?? "", /You/);
    assert.deepEqual(
      options.slice(1).map((entry) => entry.displayName),
      ["Blake", "Casey", "Zed"],
    );
  });

  it("disambiguates duplicate display names without using email", () => {
    const options = buildAvailabilityMemberOptions({
      viewerId: "u2",
      members: [
        { userId: "u2", displayName: "Alex" },
        { userId: "u1", displayName: "Alex" },
      ],
    });
    // Stable ordinals by userId: u1 → (1), u2 → (2)
    assert.equal(options[0]?.userId, "u2");
    assert.equal(options[0]?.label, "Alex (2) (You)");
    assert.equal(options[1]?.label, "Alex (1)");
    assert.equal(
      options.some((entry) => /@/.test(entry.label)),
      false,
    );
  });

  it("builds a concise heading for self and peers", () => {
    const options = buildAvailabilityMemberOptions({
      viewerId: "self",
      members: [
        { userId: "self", displayName: "Geoff" },
        { userId: "peer", displayName: "Chris" },
      ],
    });
    assert.equal(selectedMemberHeading(options, "self", "self"), "Your teams");
    assert.equal(
      selectedMemberHeading(options, "peer", "self"),
      "Chris's teams",
    );
  });
});

describe("availability grid privacy", () => {
  const teams = [
    { id: "phi", abbreviation: "PHI", city: "Philadelphia", name: "Eagles" },
    { id: "pit", abbreviation: "PIT", city: "Pittsburgh", name: "Steelers" },
    { id: "lac", abbreviation: "LAC", city: "Los Angeles", name: "Chargers" },
  ];

  it("keeps the self grid behavior for visible own picks", () => {
    const rows = buildAvailabilityGrid({
      teams,
      visiblePicks: [
        { week_id: "w1", team_id: "lac" },
        { week_id: "w2", team_id: "phi" },
      ],
      currentWeekId: "w2",
    });
    assert.equal(rows.find((row) => row.id === "phi")?.status, "CURRENT");
    assert.equal(rows.find((row) => row.id === "lac")?.status, "USED");
    assert.equal(rows.find((row) => row.id === "pit")?.status, "AVAILABLE");
  });

  it("treats another player's hidden unstarted pick as AVAILABLE", () => {
    // RLS omitted the Week 2 PHI pick from the visible set.
    const rows = buildAvailabilityGrid({
      teams,
      visiblePicks: [{ week_id: "w1", team_id: "pit" }],
      currentWeekId: "w2",
    });
    assert.equal(availabilityHidesTeam(rows, "phi"), true);
    assert.equal(rows.find((row) => row.id === "pit")?.status, "USED");
    assert.equal(
      rows.some((row) => row.status === "CURRENT" && row.id === "phi"),
      false,
    );
  });

  it("marks a revealed current-week pick as CURRENT after kickoff", () => {
    const rows = buildAvailabilityGrid({
      teams,
      visiblePicks: [
        { week_id: "w1", team_id: "lac" },
        { week_id: "w2", team_id: "phi" },
      ],
      currentWeekId: "w2",
    });
    assert.equal(rows.find((row) => row.id === "phi")?.status, "CURRENT");
    assert.equal(rows.find((row) => row.id === "lac")?.status, "USED");
  });

  it("does not invent pick metadata in the grid payload", () => {
    const rows = buildAvailabilityGrid({
      teams,
      visiblePicks: [{ week_id: "w1", team_id: "pit" }],
      currentWeekId: "w2",
    });
    const serialized = JSON.stringify(rows);
    assert.equal(serialized.includes("game_id"), false);
    assert.equal(serialized.includes("week_id"), false);
    assert.equal(rows.every((row) => Object.keys(row).sort().join() === "abbreviation,city,id,name,status"), true);
  });
});
