import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  resolveLatestSettledStandingsWeekNumber,
  resolveLiveStandingsWeekNumber,
  resolveStandingsView,
  weekHasStartedForStandings,
  weekIsSettledForStandings,
  type StandingsWeekAuthority,
} from "./standings-view.ts";

/** Week 1 final; Week 2 all kickoffs started, games still in progress; Week 3 upcoming. */
function endOfWeek2InProgress(): StandingsWeekAuthority[] {
  return [
    {
      weekNumber: 1,
      status: "final",
      signal: {
        has_non_terminal_game: false,
        has_future_kickoff: false,
        has_started_game: true,
      },
      hasPendingPickResults: false,
    },
    {
      weekNumber: 2,
      status: "open",
      signal: {
        has_non_terminal_game: true,
        has_future_kickoff: false,
        has_started_game: true,
      },
      hasPendingPickResults: true,
    },
    {
      weekNumber: 3,
      status: "upcoming",
      signal: {
        has_non_terminal_game: true,
        has_future_kickoff: true,
        has_started_game: false,
      },
      hasPendingPickResults: false,
    },
  ];
}

describe("live standings week authority", () => {
  it("keeps Week 2 live after final kickoff while games remain in progress", () => {
    const weeks = endOfWeek2InProgress();
    // effective_current would return Week 3; live standings must stay on Week 2.
    assert.equal(resolveLiveStandingsWeekNumber(weeks), 2);
    assert.equal(resolveLatestSettledStandingsWeekNumber(weeks), 1);
  });

  it("does not treat an advance-pick Week 3 as started", () => {
    const week3 = endOfWeek2InProgress()[2]!;
    assert.equal(weekHasStartedForStandings(week3), false);
    assert.equal(weekIsSettledForStandings(week3), false);
  });

  it("keeps Week 2 live when games are final but grading is incomplete", () => {
    const weeks: StandingsWeekAuthority[] = [
      {
        weekNumber: 1,
        status: "final",
        signal: {
          has_non_terminal_game: false,
          has_future_kickoff: false,
          has_started_game: true,
        },
        hasPendingPickResults: false,
      },
      {
        weekNumber: 2,
        status: "open",
        signal: {
          has_non_terminal_game: false,
          has_future_kickoff: false,
          has_started_game: true,
        },
        hasPendingPickResults: true,
      },
      {
        weekNumber: 3,
        status: "upcoming",
        signal: {
          has_non_terminal_game: true,
          has_future_kickoff: true,
          has_started_game: false,
        },
        hasPendingPickResults: false,
      },
    ];
    assert.equal(resolveLiveStandingsWeekNumber(weeks), 2);
    assert.equal(weekIsSettledForStandings(weeks[1]!), false);
  });

  it("settles Week 2 once games are terminal and picks are graded even if status is not final", () => {
    const weeks: StandingsWeekAuthority[] = [
      {
        weekNumber: 1,
        status: "final",
        signal: {
          has_non_terminal_game: false,
          has_future_kickoff: false,
          has_started_game: true,
        },
        hasPendingPickResults: false,
      },
      {
        weekNumber: 2,
        status: "open",
        signal: {
          has_non_terminal_game: false,
          has_future_kickoff: false,
          has_started_game: true,
        },
        hasPendingPickResults: false,
      },
      {
        weekNumber: 3,
        status: "upcoming",
        signal: {
          has_non_terminal_game: true,
          has_future_kickoff: true,
          has_started_game: false,
        },
        hasPendingPickResults: false,
      },
    ];
    assert.equal(weekIsSettledForStandings(weeks[1]!), true);
    assert.equal(resolveLiveStandingsWeekNumber(weeks), null);
    assert.equal(resolveLatestSettledStandingsWeekNumber(weeks), 2);
  });

  it("treats a formally final week as settled", () => {
    const week: StandingsWeekAuthority = {
      weekNumber: 2,
      status: "final",
      signal: {
        has_non_terminal_game: false,
        has_future_kickoff: false,
        has_started_game: true,
      },
      hasPendingPickResults: false,
    };
    assert.equal(weekIsSettledForStandings(week), true);
    assert.equal(resolveLiveStandingsWeekNumber([week]), null);
  });

  it("does not advance live standings when Week 3 is open for advance picks", () => {
    const weeks: StandingsWeekAuthority[] = [
      {
        weekNumber: 2,
        status: "open",
        signal: {
          has_non_terminal_game: true,
          has_future_kickoff: false,
          has_started_game: true,
        },
        hasPendingPickResults: true,
      },
      {
        weekNumber: 3,
        status: "open", // administratively open for future picks
        signal: {
          has_non_terminal_game: true,
          has_future_kickoff: true,
          has_started_game: false,
        },
        hasPendingPickResults: false,
      },
    ];
    assert.equal(resolveLiveStandingsWeekNumber(weeks), 2);
  });
});

describe("resolveStandingsView", () => {
  it("shows historical snapshot for a completed past week", () => {
    const weeks = endOfWeek2InProgress();
    const view = resolveStandingsView({
      selectedWeekNumber: 1,
      liveStandingsWeekNumber: 2,
      latestSettledWeekNumber: 1,
      weeks,
    });
    assert.equal(view.standingsMode, "historical");
    assert.equal(view.standingsThroughWeek, 1);
    assert.equal(view.title, "Standings through Week 1");
    assert.equal(view.subtitle, null);
  });

  it("shows live standings for the in-progress current week", () => {
    const weeks = endOfWeek2InProgress();
    const view = resolveStandingsView({
      selectedWeekNumber: 2,
      liveStandingsWeekNumber: 2,
      latestSettledWeekNumber: 1,
      weeks,
    });
    assert.equal(view.standingsMode, "live");
    assert.equal(view.standingsThroughWeek, 2);
    assert.equal(view.title, "Live standings through Week 2");
    assert.equal(view.subtitle, "Includes completed games so far");
  });

  it("shows current-as-of for a future selected week while Week 2 is live", () => {
    const weeks = endOfWeek2InProgress();
    const view = resolveStandingsView({
      selectedWeekNumber: 3,
      liveStandingsWeekNumber: 2,
      latestSettledWeekNumber: 1,
      weeks,
    });
    assert.equal(view.standingsMode, "current_as_of");
    assert.equal(view.standingsThroughWeek, 2);
    assert.equal(view.title, "Current standings through Week 2");
    assert.equal(view.subtitle, "Viewing Week 3");
    assert.doesNotMatch(view.title, /through Week 3/);
  });

  it("keeps Week 2 live even when earliest future kickoff is Week 3", () => {
    const weeks = endOfWeek2InProgress();
    assert.equal(resolveLiveStandingsWeekNumber(weeks), 2);
    const view = resolveStandingsView({
      selectedWeekNumber: 2,
      liveStandingsWeekNumber: resolveLiveStandingsWeekNumber(weeks),
      latestSettledWeekNumber: resolveLatestSettledStandingsWeekNumber(weeks),
      weeks,
    });
    assert.equal(view.standingsMode, "live");
    assert.equal(view.standingsThroughWeek, 2);
  });

  it("uses historical wording once Week 2 is settled", () => {
    const weeks: StandingsWeekAuthority[] = [
      {
        weekNumber: 1,
        status: "final",
        signal: {
          has_non_terminal_game: false,
          has_future_kickoff: false,
          has_started_game: true,
        },
        hasPendingPickResults: false,
      },
      {
        weekNumber: 2,
        status: "final",
        signal: {
          has_non_terminal_game: false,
          has_future_kickoff: false,
          has_started_game: true,
        },
        hasPendingPickResults: false,
      },
      {
        weekNumber: 3,
        status: "upcoming",
        signal: {
          has_non_terminal_game: true,
          has_future_kickoff: true,
          has_started_game: false,
        },
        hasPendingPickResults: false,
      },
    ];
    const live = resolveLiveStandingsWeekNumber(weeks);
    const settled = resolveLatestSettledStandingsWeekNumber(weeks);
    assert.equal(live, null);
    assert.equal(settled, 2);
    const view = resolveStandingsView({
      selectedWeekNumber: 2,
      liveStandingsWeekNumber: live,
      latestSettledWeekNumber: settled,
      weeks,
    });
    assert.equal(view.standingsMode, "historical");
    assert.equal(view.title, "Standings through Week 2");
  });

  it("returns preseason when nothing has started", () => {
    const weeks: StandingsWeekAuthority[] = [
      {
        weekNumber: 1,
        status: "upcoming",
        signal: {
          has_non_terminal_game: true,
          has_future_kickoff: true,
          has_started_game: false,
        },
        hasPendingPickResults: false,
      },
    ];
    const view = resolveStandingsView({
      selectedWeekNumber: 1,
      liveStandingsWeekNumber: resolveLiveStandingsWeekNumber(weeks),
      latestSettledWeekNumber: resolveLatestSettledStandingsWeekNumber(weeks),
      weeks,
    });
    assert.equal(view.standingsMode, "preseason");
    assert.equal(view.standingsThroughWeek, null);
  });
});
