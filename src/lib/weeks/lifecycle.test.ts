import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertFutureDeadline,
  canEditWeekDetails,
  canShowOpenAction,
  canTransitionWeekStatus,
  isStatusTransitionAllowed,
  presentWeekState,
} from "./lifecycle.ts";

const future = new Date("2026-09-20T18:00:00.000Z");
const past = "2026-09-10T18:00:00.000Z";
const later = "2026-09-25T18:00:00.000Z";

describe("week lifecycle", () => {
  it("rejects creating or editing with a past deadline", () => {
    assert.match(assertFutureDeadline(past, future) ?? "", /future/i);
    assert.equal(assertFutureDeadline(later, future), null);
  });

  it("does not allow opening a past-deadline week", () => {
    assert.match(
      canTransitionWeekStatus(
        { status: "upcoming", locksAt: past },
        "open",
        future,
      ) ?? "",
      /deadline has already passed/i,
    );
    assert.equal(
      canShowOpenAction({ status: "upcoming", locksAt: past }, future),
      false,
    );
  });

  it("allows upcoming → open when the deadline is still future", () => {
    assert.equal(
      canTransitionWeekStatus(
        { status: "upcoming", locksAt: later },
        "open",
        future,
      ),
      null,
    );
  });

  it("allows open → locked and blocks reopen", () => {
    assert.equal(
      canTransitionWeekStatus(
        { status: "open", locksAt: later },
        "locked",
        future,
      ),
      null,
    );
    assert.match(
      canTransitionWeekStatus(
        { status: "locked", locksAt: later },
        "open",
        future,
      ) ?? "",
      /cannot be reopened/i,
    );
    assert.match(
      canTransitionWeekStatus(
        { status: "final", locksAt: later },
        "open",
        future,
      ) ?? "",
      /cannot be reopened/i,
    );
  });

  it("keeps locked/final weeks uneditable", () => {
    assert.match(
      canEditWeekDetails({ status: "locked", locksAt: later }, future) ?? "",
      /read-only/i,
    );
    assert.match(
      canEditWeekDetails({ status: "final", locksAt: later }, future) ?? "",
      /read-only/i,
    );
  });

  it("documents allowed and disallowed status transitions", () => {
    assert.equal(isStatusTransitionAllowed("upcoming", "open"), true);
    assert.equal(isStatusTransitionAllowed("open", "locked"), true);
    assert.equal(isStatusTransitionAllowed("upcoming", "locked"), true);
    assert.equal(isStatusTransitionAllowed("upcoming", "final"), true);
    assert.equal(isStatusTransitionAllowed("open", "final"), true);
    assert.equal(isStatusTransitionAllowed("locked", "final"), true);
    assert.equal(isStatusTransitionAllowed("locked", "open"), false);
    assert.equal(isStatusTransitionAllowed("final", "open"), false);
    assert.equal(isStatusTransitionAllowed("open", "upcoming"), false);
  });

  it("presents current, upcoming, and deadline-passed weeks", () => {
    assert.equal(
      presentWeekState(
        { status: "upcoming", locksAt: later },
        { isEffectiveCurrent: true, now: future },
      ).kind,
      "current",
    );
    assert.equal(
      presentWeekState(
        { status: "open", locksAt: past },
        { now: future },
      ).kind,
      "deadline_passed",
    );
    assert.equal(
      presentWeekState(
        { status: "upcoming", locksAt: later },
        { now: future },
      ).tone,
      "neutral",
    );
  });
});
