import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dryRunBootstrapImport,
  emptyExistingSnapshot,
} from "./bootstrap-plan.ts";
import {
  validateBootstrapDocument,
  type BootstrapImportDocument,
} from "./bootstrap-schema.ts";

function sampleDocument(
  overrides?: Partial<BootstrapImportDocument>,
): BootstrapImportDocument {
  const weeks = Array.from({ length: 18 }, (_, index) => {
    const weekNumber = index + 1;
    return {
      week_number: weekNumber,
      label: `Week ${weekNumber}`,
      lock_date: `2026-09-${String(Math.min(8 + weekNumber, 28)).padStart(2, "0")}`,
      lock_time: "12:00",
      status:
        weekNumber === 1
          ? ("final" as const)
          : ("upcoming" as const),
    };
  });

  return {
    version: 1,
    league: {
      slug: "sunday-survivor",
      name: "Sunday Survivor",
      timezone: "America/Chicago",
    },
    season: {
      year: 2026,
      status: "active",
      regular_week_count: 18,
    },
    scoring_rules: {
      correct_regular_pick_points: 1,
      best_record_bonus: 3,
      longest_streak_bonus: 3,
      survivor_bonus: 5,
      wildcard_points: 1,
      divisional_points: 2,
      conference_points: 3,
      superbowl_points: 4,
      perfect_season_override: true,
    },
    members: [
      {
        auth_user_id: "11111111-1111-1111-1111-111111111111",
        display_name: "Commissioner",
        role: "commissioner",
        active: true,
      },
      {
        auth_user_id: "22222222-2222-2222-2222-222222222222",
        display_name: "Player Two",
        role: "player",
        active: true,
      },
    ],
    weeks,
    picks: [
      {
        week_number: 1,
        auth_user_id: "11111111-1111-1111-1111-111111111111",
        team_abbreviation: "KC",
        result: "win",
      },
    ],
    ...overrides,
  };
}

describe("bootstrap import foundation", () => {
  it("dry run performs no writes (plan only)", () => {
    const validated = validateBootstrapDocument(sampleDocument());
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const existing = emptyExistingSnapshot();
    const plan = dryRunBootstrapImport({
      document: validated.document,
      existing,
    });
    assert.equal(plan.ok, true);
    if (!plan.ok) return;
    assert.equal(plan.dryRun, true);
    assert.ok(plan.counts.inserted > 0);
    // dryRunBootstrapImport never receives a writer — success means plan-only.
  });

  it("rejects conflicting import data without overwrite", () => {
    const validated = validateBootstrapDocument(sampleDocument());
    assert.equal(validated.ok, true);
    if (!validated.ok) return;

    const existing = emptyExistingSnapshot();
    const first = dryRunBootstrapImport({
      document: validated.document,
      existing,
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;

    existing.weeksByNumber.set(1, {
      week_number: 1,
      label: "Different",
      locks_at: first.preparedWeeks[0]!.locks_at,
      status: "final",
    });

    const conflicted = dryRunBootstrapImport({
      document: validated.document,
      existing,
      allowOverwrite: false,
    });
    assert.equal(conflicted.ok, false);
    if (conflicted.ok) return;
    assert.match(conflicted.error, /conflicting/i);
    assert.ok(conflicted.conflicts.length >= 1);
  });

  it("requires sequential weeks matching regular_week_count", () => {
    const doc = sampleDocument();
    doc.weeks = doc.weeks.slice(0, 16);
    const validated = validateBootstrapDocument(doc);
    assert.equal(validated.ok, false);
  });

  it("rejects unexpected active members even without overwrite", () => {
    const validated = validateBootstrapDocument(sampleDocument());
    assert.equal(validated.ok, true);
    if (!validated.ok) return;
    const existing = emptyExistingSnapshot();
    existing.league = {
      id: "league-1",
      name: "Sunday Survivor",
      slug: "sunday-survivor",
      timezone: "America/Chicago",
      commissioner_user_id: "11111111-1111-1111-1111-111111111111",
    };
    existing.membersByUserId.set("99999999-9999-9999-9999-999999999999", {
      user_id: "99999999-9999-9999-9999-999999999999",
      role: "player",
      active: true,
    });
    const plan = dryRunBootstrapImport({
      document: validated.document,
      existing,
      allowOverwrite: true,
    });
    assert.equal(plan.ok, false);
    if (plan.ok) return;
    assert.match(plan.error, /Unexpected active league member/i);
  });
});
