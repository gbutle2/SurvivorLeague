import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { computeBadge, countsTowardAlertBadge } from "./unread.ts";

describe("computeBadge", () => {
  it("uses league unread only for the red dot", () => {
    assert.deepEqual(
      computeBadge({
        leagueUnread: true,
        dmUnreadCount: 0,
        alertUnreadCount: 0,
      }),
      { redDot: true, numericBadge: 0 },
    );
    assert.deepEqual(
      computeBadge({
        leagueUnread: false,
        dmUnreadCount: 2,
        alertUnreadCount: 1,
      }),
      { redDot: false, numericBadge: 3 },
    );
  });

  it("sums DM unreads with non-DM alert unreads", () => {
    assert.deepEqual(
      computeBadge({
        leagueUnread: true,
        dmUnreadCount: 2,
        alertUnreadCount: 3,
      }),
      { redDot: true, numericBadge: 5 },
    );
  });

  it("floors negative counts at zero", () => {
    assert.deepEqual(
      computeBadge({
        leagueUnread: false,
        dmUnreadCount: -1,
        alertUnreadCount: -4,
      }),
      { redDot: false, numericBadge: 0 },
    );
  });
});

describe("countsTowardAlertBadge", () => {
  it("excludes direct_message to avoid double-counting with DM unreads", () => {
    assert.equal(countsTowardAlertBadge("direct_message"), false);
    assert.equal(countsTowardAlertBadge("week_opened"), true);
    assert.equal(countsTowardAlertBadge("commissioner_pick_changed"), true);
  });
});
