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

function renderDashboard(
  overrides: Partial<React.ComponentProps<typeof LeagueDashboard>> = {},
) {
  return render(
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
        {
          userId: "u2",
          displayName: "Peer",
          team: null,
          state: "hidden",
          result: "pending",
          points: 0,
          survivorAliveAfterWeek: true,
          overridden: false,
        },
      ]}
      weekSelector={<div>Week selector</div>}
      yourPick={<div data-testid="your-pick-slot">Your Pick</div>}
      {...overrides}
    />,
  );
}

describe("LeagueDashboard standings headings", () => {
  it("renders historical Standings through Week 1", () => {
    const { getByText, queryByText } = renderDashboard({
      weekNumber: 1,
      weekLabel: "Week 1 — Final",
      standingsTitle: "Standings through Week 1",
      standingsSubtitle: null,
      weeklyPicks: [
        {
          userId: "u1",
          displayName: "You",
          team: "KC",
          state: "visible",
          result: "win",
          points: 1,
          survivorAliveAfterWeek: true,
          overridden: false,
        },
      ],
    });
    assert.ok(getByText("Standings through Week 1"));
    assert.equal(queryByText("Includes completed games so far"), null);
  });

  it("renders live standings title and subtitle above weekly picks", () => {
    const { container, getByText } = renderDashboard();

    assert.ok(getByText("Live standings through Week 2"));
    assert.ok(getByText("Includes completed games so far"));

    const sections = [
      ...container.querySelectorAll("[data-dashboard-section]"),
    ].map((el) => el.getAttribute("data-dashboard-section"));
    assert.deepEqual(sections, [
      "week_selector",
      "summary_metrics",
      "standings",
      "league_picks_results",
      "your_pick",
    ]);
  });

  it("renders future-week current-as-of heading while picks stay on Week 3", () => {
    const { getByText, getAllByText } = renderDashboard({
      weekNumber: 3,
      weekLabel: "Week 3 — Upcoming",
      standingsTitle: "Current standings through Week 2",
      standingsSubtitle: "Viewing Week 3",
      weeklyPicks: [
        {
          userId: "u1",
          displayName: "You",
          team: "DET",
          state: "visible",
          result: "pending",
          points: 0,
          survivorAliveAfterWeek: true,
          overridden: false,
        },
        {
          userId: "u2",
          displayName: "Peer",
          team: null,
          state: "hidden",
          result: null,
          points: 0,
          survivorAliveAfterWeek: true,
          overridden: false,
        },
      ],
    });
    assert.ok(getByText("Current standings through Week 2"));
    assert.ok(getByText("Viewing Week 3"));
    assert.ok(getByText("Week 3 — Upcoming results"));
    // Pending current-week / selected-week rows (mobile + desktop)
    assert.ok(getAllByText(/Pending/i).length >= 1);
    assert.ok(getAllByText(/Submitted|Pick submitted/).length >= 1);
    assert.ok(getAllByText("DET").length >= 1);
  });

  it("shows pending for unresolved current-week rows without revealing hidden teams", () => {
    const { getAllByText, queryByText } = renderDashboard({
      weeklyPicks: [
        {
          userId: "u1",
          displayName: "You",
          team: "SF",
          state: "visible",
          result: "pending",
          points: 0,
          survivorAliveAfterWeek: true,
          overridden: false,
        },
        {
          userId: "u2",
          displayName: "Peer",
          team: null,
          state: "hidden",
          result: "pending",
          points: 0,
          survivorAliveAfterWeek: true,
          overridden: false,
        },
      ],
    });
    assert.ok(getAllByText("SF").length >= 1);
    assert.ok(getAllByText(/Submitted|Pick submitted/).length >= 1);
    assert.equal(queryByText("BUF"), null);
  });
});
