import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  chicagoWallTimeToUtc,
  formatCentralDateTime,
  toChicagoDateAndTimeInputs,
} from "./chicago.ts";

describe("Central Time conversion", () => {
  it("converts CDT summer wall time to UTC", () => {
    const utc = chicagoWallTimeToUtc("2026-07-15", "12:00");
    assert.equal(utc.toISOString(), "2026-07-15T17:00:00.000Z");
  });

  it("converts CST winter wall time to UTC", () => {
    const utc = chicagoWallTimeToUtc("2026-01-15", "12:00");
    assert.equal(utc.toISOString(), "2026-01-15T18:00:00.000Z");
  });

  it("formats UTC instants explicitly in Central Time", () => {
    const label = formatCentralDateTime("2026-07-15T17:00:00.000Z");
    assert.match(label, /Jul/);
    assert.match(label, /15/);
    assert.match(label, /2026/);
    assert.match(label, /CDT|GMT-5|Central/);
  });

  it("round-trips Chicago input values from UTC", () => {
    const parts = toChicagoDateAndTimeInputs("2026-11-01T06:30:00.000Z");
    assert.equal(parts.date, "2026-11-01");
    assert.equal(parts.time, "01:30");
  });

  it("rejects nonexistent spring-forward local times", () => {
    assert.throws(
      () => chicagoWallTimeToUtc("2026-03-08", "02:30"),
      /does not exist|DST/i,
    );
  });
});
