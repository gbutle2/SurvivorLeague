import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertDedicatedSyncClient } from "./sync.ts";

describe("syncNflSchedule client contract", () => {
  it("rejects pg.Pool-like objects with totalCount", () => {
    const poolLike = {
      totalCount: 0,
      query: async () => ({ rows: [] }),
    };
    assert.throws(
      () => assertDedicatedSyncClient(poolLike as never),
      /dedicated pg\.Client/i,
    );
  });

  it("accepts a dedicated client-shaped query handle", () => {
    const client = { query: async () => ({ rows: [] }) };
    assert.doesNotThrow(() => assertDedicatedSyncClient(client as never));
  });
});
