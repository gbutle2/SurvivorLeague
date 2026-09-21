import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DASHBOARD_SECTION_ORDER,
  dashboardSectionPrecedes,
} from "./section-order.ts";

describe("dashboard section order", () => {
  it("places standings and league picks/results before Your Pick", () => {
    assert.ok(
      dashboardSectionPrecedes("standings", "your_pick"),
      "standings before your_pick",
    );
    assert.ok(
      dashboardSectionPrecedes("league_picks_results", "your_pick"),
      "league_picks_results before your_pick",
    );
    assert.ok(
      dashboardSectionPrecedes("summary_metrics", "standings"),
      "summary before standings",
    );
    assert.ok(
      dashboardSectionPrecedes("week_selector", "summary_metrics"),
      "week selector first among body sections",
    );
  });

  it("keeps the same hierarchy for mobile and desktop layouts", () => {
    // LeagueDashboard renders one ordered tree; responsive variants only
    // change presentation inside standings / picks sections.
    assert.deepEqual([...DASHBOARD_SECTION_ORDER], [
      "week_selector",
      "summary_metrics",
      "standings",
      "league_picks_results",
      "your_pick",
    ]);
  });
});
