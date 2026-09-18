import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Perfect regular season requires 18 wins under authoritative league rules. */
export function isPerfectRegularSeason(wins: number, weekCount = 18): boolean {
  return wins === weekCount;
}

export function playoffPointsTotal(roundWins: number[]): number {
  const table = [1, 2, 3, 4];
  return roundWins.reduce(
    (sum, won, index) => sum + (won ? table[index]! : 0),
    0,
  );
}

describe("scoring defaults (18-week season)", () => {
  it("perfect season requires 18 wins", () => {
    assert.equal(isPerfectRegularSeason(17), false);
    assert.equal(isPerfectRegularSeason(18), true);
  });

  it("playoff maximum is 10", () => {
    assert.equal(playoffPointsTotal([1, 1, 1, 1]), 10);
    assert.equal(playoffPointsTotal([1, 1, 0, 0]), 3);
  });
});
