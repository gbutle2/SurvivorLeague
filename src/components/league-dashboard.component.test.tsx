import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React from "react";

import "../test/setup-dom.ts";

import { cleanup, render } from "@testing-library/react";

import { LeagueDashboard } from "@/components/league-dashboard";
import { resetDomBody } from "../test/dom.ts";

afterEach(() => {
  cleanup();
  resetDomBody();
});

const sampleStanding = {
  userId: "u1",
  displayName: "You",
  wins: 2,
  losses: 0,
  ties: 0,
  missed: 0,
  currentStreak: 2,
  longestStreak: 2,
  survivorAlive: true,
  pointsEarned: 2,
  maxPossible: 18,
};

describe("LeagueDashboard standings headings", () => {
  it("renders live standings title and subtitle above weekly picks", () => {
    const { container, getByText } = render(
      <LeagueDashboard
        currentUserId="u1"
        weekNumber={2}
        weekLabel="Week 2 — In progress"
        standingsTitle="Live standings through Week 2"
        standingsSubtitle="Includes completed games so far"
        standings={[sampleStanding]}
        weeklyPicks={[
          {
            userId: "u1",
            displayName: "You",
            team: "SF",
            state: "visible",
            result: "win",
            points: 1,
            survivorAliveAfterWeek: true,
            overridden: false,
          },
        ]}
        weekSelector={<div>Week selector</div>}
        yourPick={<div data-testid="your-pick-slot">Your Pick</div>}
      />,
    );

    assert.ok(getByText("Live standings through Week 2"));
    assert.ok(getByText("Includes completed games so far"));

    const sections = [
      ...container.querySelectorAll("[data-dashboard-section]"),
    ].map((el) => el.getAttribute("data-dashboard-section"));
    assert.ok(sections.indexOf("standings") < sections.indexOf("league_picks_results"));
    assert.ok(sections.indexOf("league_picks_results") < sections.indexOf("your_pick"));
  });

  it("renders future-week current-as-of heading with viewing subtitle", () => {
    const { getByText } = render(
      <LeagueDashboard
        currentUserId="u1"
        weekNumber={3}
        weekLabel="Week 3 — Upcoming"
        standingsTitle="Current standings through Week 2"
        standingsSubtitle="Viewing Week 3"
        standings={[sampleStanding]}
        weeklyPicks={[]}
        weekSelector={<div>Week selector</div>}
        yourPick={<div>Your Pick</div>}
      />,
    );
    assert.ok(getByText("Current standings through Week 2"));
    assert.ok(getByText("Viewing Week 3"));
  });
});
