import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isStatusTransitionAllowed } from "./lifecycle.ts";
import {
  planRegularWeekFinalizations,
  reconcileRegularWeekFinalStatuses,
  shouldReconcileWeekToFinal,
  type WeekFinalCoverage,
} from "./reconcile-final.ts";

function coverage(
  partial: Partial<WeekFinalCoverage> &
    Pick<WeekFinalCoverage, "weekNumber" | "storedStatus">,
): WeekFinalCoverage {
  return {
    gameCount: partial.gameCount ?? 16,
    nonTerminalCount: partial.nonTerminalCount ?? 0,
    weekNumber: partial.weekNumber,
    storedStatus: partial.storedStatus,
  };
}

describe("regular week final reconciliation", () => {
  it("allows upcoming historical weeks with all games terminal to finalize", () => {
    assert.equal(
      shouldReconcileWeekToFinal(
        coverage({ weekNumber: 1, storedStatus: "upcoming" }),
      ),
      true,
    );
    assert.deepEqual(
      planRegularWeekFinalizations([
        coverage({ weekNumber: 1, storedStatus: "upcoming" }),
      ]),
      [1],
    );
  });

  it("finalizes open or locked weeks when every game is terminal", () => {
    assert.equal(
      shouldReconcileWeekToFinal(
        coverage({ weekNumber: 2, storedStatus: "open" }),
      ),
      true,
    );
    assert.equal(
      shouldReconcileWeekToFinal(
        coverage({ weekNumber: 3, storedStatus: "locked" }),
      ),
      true,
    );
  });

  it("does not finalize when any game is nonterminal", () => {
    assert.equal(
      shouldReconcileWeekToFinal(
        coverage({
          weekNumber: 2,
          storedStatus: "upcoming",
          gameCount: 16,
          nonTerminalCount: 15,
        }),
      ),
      false,
    );
  });

  it("does not finalize weeks with missing schedule coverage", () => {
    assert.equal(
      shouldReconcileWeekToFinal(
        coverage({
          weekNumber: 4,
          storedStatus: "upcoming",
          gameCount: 0,
          nonTerminalCount: 0,
        }),
      ),
      false,
    );
  });

  it("leaves an already-final week unchanged (idempotent no-op)", () => {
    assert.equal(
      shouldReconcileWeekToFinal(
        coverage({ weekNumber: 1, storedStatus: "final" }),
      ),
      false,
    );
  });

  it("does not plan Week 2 while its games are not all final", () => {
    const planned = planRegularWeekFinalizations([
      coverage({ weekNumber: 1, storedStatus: "upcoming" }),
      coverage({
        weekNumber: 2,
        storedStatus: "upcoming",
        gameCount: 16,
        nonTerminalCount: 15,
      }),
    ]);
    assert.deepEqual(planned, [1]);
  });

  it("documents sync-owned upcoming/open/locked → final transitions", () => {
    assert.equal(isStatusTransitionAllowed("upcoming", "final"), true);
    assert.equal(isStatusTransitionAllowed("open", "final"), true);
    assert.equal(isStatusTransitionAllowed("locked", "final"), true);
    assert.equal(isStatusTransitionAllowed("final", "open"), false);
  });

  it("runs an idempotent SQL update that only returns newly finalized weeks", async () => {
    const calls: Array<{ sql: string; params?: unknown[] }> = [];
    const client = {
      query: async (sql: string, params?: unknown[]) => {
        calls.push({ sql, params });
        return { rows: [{ week_number: 1 }] };
      },
    };

    const first = await reconcileRegularWeekFinalStatuses(client, 2026);
    assert.deepEqual(first.finalizedWeekNumbers, [1]);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.sql, /status = 'final'/i);
    assert.match(calls[0]!.sql, /NOT IN \('final', 'canceled'\)/);
    assert.deepEqual(calls[0]!.params, [2026]);

    const noopClient = {
      query: async () => ({ rows: [] }),
    };
    const second = await reconcileRegularWeekFinalStatuses(noopClient, 2026);
    assert.deepEqual(second.finalizedWeekNumbers, []);
  });

  it("update SQL does not mutate picks or games", async () => {
    const client = {
      query: async (sql: string) => {
        assert.doesNotMatch(sql, /\bUPDATE\s+public\.picks\b/i);
        assert.doesNotMatch(sql, /\bUPDATE\s+public\.games\b/i);
        assert.match(sql, /\bUPDATE\s+public\.weeks\b/i);
        return { rows: [] };
      },
    };
    await reconcileRegularWeekFinalStatuses(client, 2026);
  });
});
