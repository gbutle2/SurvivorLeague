import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import React, { type ComponentProps } from "react";

import "../../test/setup-dom.ts";

import { cleanup, render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LeagueDashboard } from "@/components/league-dashboard";
import { PickForm } from "@/app/pick/pick-form";
import type { PickActionState } from "@/app/pick/actions";
import type { PickGameOption } from "@/lib/nfl/schedule-query";
import { PICK_UNVERIFIED_MESSAGE } from "@/lib/picks/eligibility";
import { resetDomBody } from "../../test/dom.ts";

afterEach(() => {
  cleanup();
  resetDomBody();
});

const SF_KICKOFF = "2026-09-27T20:05:00.000Z"; // Sun Sep 27 3:05 PM CDT
const NOW_MS = Date.parse("2026-09-21T21:00:00.000Z"); // Mon Sep 21

const sfOption: PickGameOption = {
  gameId: "g-sf",
  teamId: "sf",
  abbreviation: "SF",
  city: "San Francisco",
  name: "49ers",
  opponentAbbreviation: "LAR",
  homeAway: "home",
  kickoffAt: SF_KICKOFF,
  status: "scheduled",
  used: false,
  locked: false,
};

const larOption: PickGameOption = {
  ...sfOption,
  teamId: "lar",
  abbreviation: "LAR",
  city: "Los Angeles",
  name: "Rams",
  opponentAbbreviation: "SF",
  homeAway: "away",
};

const savedSummary = {
  teamId: "sf",
  abbreviation: "SF",
  city: "San Francisco",
  name: "49ers",
  opponentAbbreviation: "LAR",
  homeAway: "home" as const,
  kickoffAt: SF_KICKOFF,
};

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
  maxPossible: 60,
};

function basePickProps(
  overrides: Partial<ComponentProps<typeof PickForm>> = {},
) {
  return {
    weekId: "week-3",
    weekNumber: 3,
    teams: [sfOption, larOption],
    initialTeamId: "sf" as string | null,
    weekLabel: "Week 3",
    existingPickState: "editable" as const,
    lastSyncLabel: "never",
    nowMs: NOW_MS,
    savedSummary,
    ...overrides,
  };
}

describe("LeagueDashboard rendered order", () => {
  it("renders standings before picks/results before Your Pick", () => {
    const { container, getByTestId } = render(
      <LeagueDashboard
        currentUserId="u1"
        weekNumber={3}
        weekLabel="Week 3"
        standingsTitle="Standings through Week 3"
        standings={[sampleStanding]}
        weeklyPicks={[
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
        ]}
        weekSelector={<div>Week selector</div>}
        yourPick={<div data-testid="your-pick-slot">Your Pick panel</div>}
      />,
    );

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

    assert.ok(sections.indexOf("standings") < sections.indexOf("league_picks_results"));
    assert.ok(sections.indexOf("league_picks_results") < sections.indexOf("your_pick"));
    assert.ok(getByTestId("your-pick-slot"));
  });
});

describe("PickForm rendered behavior", () => {
  it("starts collapsed for an existing editable SF pick without search/list", () => {
    const { getByText, getByRole, getByTestId, queryByTestId } = render(
      <PickForm {...basePickProps()} />,
    );

    assert.match(getByText(/Your Pick · Week 3/i).textContent ?? "", /Week 3/);
    assert.match(getByRole("heading", { level: 2 }).textContent ?? "", /49ers/);
    assert.match(getByText(/Editable until/i).textContent ?? "", /Editable until/);
    assert.equal(queryByTestId("pick-search"), null);
    assert.equal(queryByTestId("pick-team-list"), null);
    assert.equal(queryByTestId("pick-editor"), null);

    const change = getByTestId("pick-primary-action");
    assert.equal(change.textContent, "Change pick");
    assert.equal(change.getAttribute("aria-expanded"), "false");
  });

  it("expands on Change pick and collapses on Cancel without changing selection", async () => {
    const user = userEvent.setup();
    const view = render(<PickForm {...basePickProps()} />);

    await user.click(view.getByTestId("pick-primary-action"));
    assert.ok(view.getByTestId("pick-editor"));
    assert.ok(view.getByTestId("pick-search"));
    assert.ok(view.getByTestId("pick-team-list"));
    assert.equal(
      view.getByTestId("pick-expand-toggle").getAttribute("aria-expanded"),
      "true",
    );

    const larRadio = view.getByDisplayValue("lar") as HTMLInputElement;
    await user.click(larRadio);
    assert.equal(larRadio.checked, true);

    await user.click(view.getByTestId("pick-cancel"));
    assert.equal(view.queryByTestId("pick-editor"), null);

    await user.click(view.getByTestId("pick-primary-action"));
    const sfRadio = view.getByDisplayValue("sf") as HTMLInputElement;
    assert.equal(sfRadio.checked, true, "Cancel restores saved SF selection");
  });

  it("does not expose an editable form for locked picks", () => {
    const { queryByTestId, getByText } = render(
      <PickForm
        {...basePickProps({
          existingPickState: "locked",
        })}
      />,
    );
    assert.equal(queryByTestId("pick-primary-action"), null);
    assert.equal(queryByTestId("pick-editor"), null);
    assert.equal(queryByTestId("pick-expand-toggle"), null);
    assert.ok(getByText(/Locked at kickoff/i));
  });

  it("does not expose an editable form when the saved pick is unverified", () => {
    const { queryByTestId, getByText } = render(
      <PickForm
        {...basePickProps({
          existingPickState: "unavailable",
          teams: [],
        })}
      />,
    );
    assert.equal(queryByTestId("pick-editor"), null);
    assert.equal(queryByTestId("pick-primary-action"), null);
    assert.ok(getByText(PICK_UNVERIFIED_MESSAGE));
    assert.ok(getByText(/49ers/));
  });

  it("exposes Make pick when there is no saved pick", async () => {
    const user = userEvent.setup();
    const { getByTestId } = render(
      <PickForm
        {...basePickProps({
          initialTeamId: null,
          savedSummary: null,
        })}
      />,
    );
    // No-pick defaults expanded with the editor visible.
    assert.ok(getByTestId("pick-editor"));
    assert.equal(
      getByTestId("pick-expand-toggle").getAttribute("aria-expanded"),
      "true",
    );
    // Collapse, then the Make pick action must appear.
    await user.click(getByTestId("pick-expand-toggle"));
    assert.equal(getByTestId("pick-primary-action").textContent, "Make pick");
    await user.click(getByTestId("pick-primary-action"));
    assert.ok(getByTestId("pick-editor"));
  });

  it("clears a stale action error when remounted for a new week (week navigation)", () => {
    const stale: PickActionState = {
      error:
        "That game is locked (kickoff has passed) or is not selectable. Choose another team.",
      success: null,
      savedTeamId: null,
      savedTeamLabel: null,
    };

    const { rerender, getByTestId, queryByTestId, getByRole } = render(
      <PickForm
        key="week-2"
        {...basePickProps({
          weekId: "week-2",
          weekNumber: 2,
          initialActionState: stale,
          existingPickState: "editable",
        })}
      />,
    );

    assert.ok(getByTestId("pick-error"));

    rerender(
      <PickForm
        key="week-3"
        {...basePickProps({
          weekId: "week-3",
          weekNumber: 3,
        })}
      />,
    );

    assert.equal(queryByTestId("pick-error"), null);
    assert.match(getByRole("heading", { level: 2 }).textContent ?? "", /49ers/);
    assert.equal(queryByTestId("pick-editor"), null);
  });

  it("collapses after a successful save", async () => {
    const user = userEvent.setup();
    const actionOverride = async (): Promise<PickActionState> => ({
      error: null,
      success: "Saved San Francisco 49ers (SF) for Week 3.",
      savedTeamId: "sf",
      savedTeamLabel: "San Francisco 49ers (SF)",
    });

    const view = render(
      <PickForm
        {...basePickProps({
          actionOverride,
        })}
      />,
    );

    await user.click(view.getByTestId("pick-primary-action"));
    await user.click(view.getByTestId("pick-save"));

    await view.findByTestId("pick-primary-action");
    assert.equal(view.queryByTestId("pick-editor"), null);
  });

  it("stays expanded with the accurate error after a failed save", async () => {
    const user = userEvent.setup();
    const actionOverride = async (): Promise<PickActionState> => ({
      error: "You already used this team in Week 1.",
      success: null,
      savedTeamId: null,
      savedTeamLabel: null,
    });

    const view = render(
      <PickForm
        {...basePickProps({
          actionOverride,
        })}
      />,
    );

    await user.click(view.getByTestId("pick-primary-action"));
    await user.click(view.getByTestId("pick-save"));

    const alert = await view.findByTestId("pick-error");
    assert.equal(alert.textContent, "You already used this team in Week 1.");
    assert.ok(view.getByTestId("pick-editor"));
    assert.equal(
      view.getByTestId("pick-expand-toggle").getAttribute("aria-expanded"),
      "true",
    );
  });

  it("keeps SF selectable in the editor even when marked used in options", async () => {
    const user = userEvent.setup();
    const usedSf = { ...sfOption, used: true };
    const view = render(
      <PickForm
        {...basePickProps({
          teams: [usedSf, larOption],
        })}
      />,
    );
    await user.click(view.getByTestId("pick-primary-action"));
    const sfRadio = view.getByDisplayValue("sf") as HTMLInputElement;
    assert.equal(sfRadio.disabled, false);
    assert.equal(sfRadio.checked, true);
  });
});

describe("SF Week 3 Monday fixture (rendered)", () => {
  it("shows no error, collapsed editable SF summary, and dashboard hierarchy above Your Pick", () => {
    const { container } = render(
      <div>
        <LeagueDashboard
          currentUserId="u1"
          weekNumber={3}
          weekLabel="Week 3"
          standingsTitle="Standings"
          standings={[sampleStanding]}
          weeklyPicks={[
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
          ]}
          weekSelector={<div>Week 3</div>}
          yourPick={<PickForm {...basePickProps()} />}
        />
      </div>,
    );

    const sections = [
      ...container.querySelectorAll("[data-dashboard-section]"),
    ].map((el) => el.getAttribute("data-dashboard-section"));
    assert.ok(sections.indexOf("standings") < sections.indexOf("your_pick"));
    assert.ok(
      sections.indexOf("league_picks_results") < sections.indexOf("your_pick"),
    );

    const yourPick = container.querySelector(
      '[data-dashboard-section="your_pick"]',
    );
    assert.ok(yourPick);
    assert.equal(within(yourPick as HTMLElement).queryByRole("alert"), null);
    assert.match((yourPick as HTMLElement).textContent ?? "", /Editable until/);
    assert.equal(
      within(yourPick as HTMLElement).queryByTestId("pick-editor"),
      null,
    );
  });
});
