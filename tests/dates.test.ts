import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidDate, rangesOverlap, todayUtc } from "../convex/dates.ts";

test("isValidDate", () => {
  assert.ok(isValidDate("2026-11-12"));
  assert.ok(isValidDate("2028-02-29"));
  assert.ok(!isValidDate("2026-02-30"));
  assert.ok(!isValidDate("2026-13-01"));
  assert.ok(!isValidDate("12/11/2026"));
  assert.ok(!isValidDate("2026-1-1"));
});

test("rangesOverlap is inclusive on both ends", () => {
  const a = { startDate: "2026-11-10", endDate: "2026-11-15" };
  assert.ok(rangesOverlap(a, { startDate: "2026-11-15", endDate: "2026-11-20" }));
  assert.ok(rangesOverlap(a, { startDate: "2026-11-01", endDate: "2026-11-10" }));
  assert.ok(rangesOverlap(a, { startDate: "2026-11-12", endDate: "2026-11-13" }));
  assert.ok(!rangesOverlap(a, { startDate: "2026-11-16", endDate: "2026-11-20" }));
  assert.ok(!rangesOverlap(a, { startDate: "2026-11-01", endDate: "2026-11-09" }));
});

test("todayUtc formats as YYYY-MM-DD", () => {
  assert.equal(todayUtc(new Date("2026-11-12T23:59:59Z")), "2026-11-12");
});
