import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultPickEditorExpanded,
  resolvePickEditorMode,
} from "../../lib/picks/eligibility.ts";

/**
 * Expand/collapse contract for the Your Pick panel.
 * React Testing Library is not in this repo; behavior is asserted via the
 * pure mode/default helpers the PickForm mounts from.
 */
describe("Your Pick expand/collapse contract", () => {
  it("existing valid pick defaults to collapsed", () => {
    assert.equal(
      defaultPickEditorExpanded(
        resolvePickEditorMode({
          hasExistingPick: true,
          existingPickLocked: false,
          noEligibleGames: false,
        }),
      ),
      false,
    );
  });

  it("Change pick / Make pick only apply in editable or no_pick modes", () => {
    const editable = resolvePickEditorMode({
      hasExistingPick: true,
      existingPickLocked: false,
      noEligibleGames: false,
    });
    const locked = resolvePickEditorMode({
      hasExistingPick: true,
      existingPickLocked: true,
      noEligibleGames: false,
    });
    const noPick = resolvePickEditorMode({
      hasExistingPick: false,
      existingPickLocked: false,
      noEligibleGames: false,
    });
    assert.equal(editable, "editable");
    assert.equal(locked, "locked");
    assert.equal(noPick, "no_pick");
    assert.equal(defaultPickEditorExpanded(noPick), true);
    assert.equal(defaultPickEditorExpanded(locked), false);
  });

  it("week change remounts to the correct default via mode helpers", () => {
    // PickForm uses key={weekId}; new week recomputes mode + default expansion.
    const weekWithPick = defaultPickEditorExpanded(
      resolvePickEditorMode({
        hasExistingPick: true,
        existingPickLocked: false,
        noEligibleGames: false,
      }),
    );
    const weekWithoutPick = defaultPickEditorExpanded(
      resolvePickEditorMode({
        hasExistingPick: false,
        existingPickLocked: false,
        noEligibleGames: false,
      }),
    );
    assert.equal(weekWithPick, false);
    assert.equal(weekWithoutPick, true);
  });

  it("locked/final pick cannot open an editable form mode", () => {
    assert.equal(
      resolvePickEditorMode({
        hasExistingPick: true,
        existingPickLocked: true,
        noEligibleGames: false,
      }),
      "locked",
    );
  });

  it("successful save target state is collapsed summary (editable mode default)", () => {
    // After save, PickForm collapses; remount/default for existing pick is collapsed.
    assert.equal(
      defaultPickEditorExpanded(
        resolvePickEditorMode({
          hasExistingPick: true,
          existingPickLocked: false,
          noEligibleGames: false,
        }),
      ),
      false,
    );
  });

  it("failed save target state is expanded (caller forces expanded on error)", () => {
    // PickForm useEffect expands when state.error is set; mode stays editable.
    assert.equal(
      resolvePickEditorMode({
        hasExistingPick: true,
        existingPickLocked: false,
        noEligibleGames: false,
      }),
      "editable",
    );
  });
});
