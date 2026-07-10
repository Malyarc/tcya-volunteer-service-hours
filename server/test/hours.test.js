// Unit tests for the pure hours-derivation helpers. These run without a server
// or database and pin down the rounding + timezone edge cases that the derived
// hours model depends on. Every expected value below is hand-computed against
// the rule in the comment.

import test from "node:test";
import assert from "node:assert/strict";
import { hoursBetween, isComplete, localHHMM } from "../src/hours.js";

// ---------------- hoursBetween: rounds to the nearest quarter hour ----------------

test("hoursBetween: exact multiples of an hour are returned as-is", () => {
  assert.equal(hoursBetween("2026-03-15T16:00:00Z", "2026-03-15T19:00:00Z"), 3);
  assert.equal(hoursBetween("2026-03-15T16:00:00Z", "2026-03-15T17:00:00Z"), 1);
});

test("hoursBetween: 90 minutes = 1.5", () => {
  assert.equal(hoursBetween("2026-03-15T16:00:00Z", "2026-03-15T17:30:00Z"), 1.5);
});

test("hoursBetween: rounds to the nearest 0.25 (7 min -> 0, 8 min -> 0.25)", () => {
  // 7 min = 0.11667h; *4 = 0.4667; round 0 -> 0.
  assert.equal(hoursBetween("2026-03-15T16:00:00Z", "2026-03-15T16:07:00Z"), 0);
  // 8 min = 0.13333h; *4 = 0.5333; round 1 -> 0.25.
  assert.equal(hoursBetween("2026-03-15T16:00:00Z", "2026-03-15T16:08:00Z"), 0.25);
  // 22 min = 0.36667h; *4 = 1.4667; round 1 -> 0.25.
  assert.equal(hoursBetween("2026-03-15T16:00:00Z", "2026-03-15T16:22:00Z"), 0.25);
  // 23 min = 0.38333h; *4 = 1.5333; round 2 -> 0.5.
  assert.equal(hoursBetween("2026-03-15T16:00:00Z", "2026-03-15T16:23:00Z"), 0.5);
});

test("hoursBetween: 2h22m rounds to 2.25", () => {
  // 142 min = 2.36667h; *4 = 9.4667; round 9 -> 2.25.
  assert.equal(hoursBetween("2026-03-15T16:00:00Z", "2026-03-15T18:22:00Z"), 2.25);
});

test("hoursBetween: non-positive gaps and missing inputs are 0", () => {
  assert.equal(hoursBetween("2026-03-15T19:00:00Z", "2026-03-15T16:00:00Z"), 0); // reversed
  assert.equal(hoursBetween("2026-03-15T16:00:00Z", "2026-03-15T16:00:00Z"), 0); // equal
  assert.equal(hoursBetween(null, "2026-03-15T16:00:00Z"), 0);
  assert.equal(hoursBetween("2026-03-15T16:00:00Z", null), 0);
  assert.equal(hoursBetween(null, null), 0);
  assert.equal(hoursBetween("", ""), 0);
});

test("hoursBetween: elapsed time is timezone/DST independent (epoch math)", () => {
  // A 3-hour absolute gap straddling the US spring-forward instant is still 3h
  // because both ends are absolute UTC instants — no wall-clock arithmetic.
  assert.equal(hoursBetween("2026-03-08T08:30:00Z", "2026-03-08T11:30:00Z"), 3);
});

// ---------------- isComplete: raw completeness, decoupled from rounded hours ----------------

test("isComplete: both timestamps set with checkout strictly after check-in", () => {
  assert.equal(isComplete("2026-03-15T16:00:00Z", "2026-03-15T19:00:00Z"), true);
});

test("isComplete: a genuinely-complete but sub-quarter-hour visit is still complete", () => {
  // The KEY decoupling: hoursBetween rounds this to 0, but the row IS complete,
  // so it must still yield a (0-hour) submission rather than vanishing.
  assert.equal(hoursBetween("2026-03-15T16:00:00Z", "2026-03-15T16:05:00Z"), 0);
  assert.equal(isComplete("2026-03-15T16:00:00Z", "2026-03-15T16:05:00Z"), true);
});

test("isComplete: equal / reversed / missing timestamps are NOT complete", () => {
  assert.equal(isComplete("2026-03-15T16:00:00Z", "2026-03-15T16:00:00Z"), false);
  assert.equal(isComplete("2026-03-15T19:00:00Z", "2026-03-15T16:00:00Z"), false);
  assert.equal(isComplete(null, "2026-03-15T16:00:00Z"), false);
  assert.equal(isComplete("2026-03-15T16:00:00Z", null), false);
  assert.equal(isComplete(null, null), false);
});

// ---------------- localHHMM: wall-clock rendering, timezone-aware ----------------

test("localHHMM: default chapter tz (America/Los_Angeles) during PDT", () => {
  // 2026-03-15 is after the Mar 8 spring-forward, so LA is PDT (UTC-7).
  assert.equal(localHHMM("2026-03-15T16:00:00Z"), "09:00");
  assert.equal(localHHMM("2026-03-15T19:00:00Z"), "12:00");
});

test("localHHMM: honors standard time vs daylight time (not a fixed offset)", () => {
  // Jan 15 -> LA is PST (UTC-8): 20:00Z -> 12:00 local.
  assert.equal(localHHMM("2026-01-15T20:00:00Z"), "12:00");
  // Jul 15 -> LA is PDT (UTC-7): 19:00Z -> 12:00 local (same wall clock, diff UTC).
  assert.equal(localHHMM("2026-07-15T19:00:00Z"), "12:00");
});

test("localHHMM: respects an explicit timezone argument", () => {
  // America/New_York is EDT (UTC-4) on this date.
  assert.equal(localHHMM("2026-03-15T16:00:00Z", "America/New_York"), "12:00");
  assert.equal(localHHMM("2026-03-15T16:00:00Z", "UTC"), "16:00");
});

test("localHHMM: midnight renders as 00:00, not 24:00", () => {
  // 07:00Z in LA (PDT-7) is 00:00 local.
  assert.equal(localHHMM("2026-03-15T07:00:00Z"), "00:00");
});

test("localHHMM: empty / invalid input yields an empty string, never throws", () => {
  assert.equal(localHHMM(""), "");
  assert.equal(localHHMM(null), "");
  assert.equal(localHHMM(undefined), "");
  assert.equal(localHHMM("not-a-timestamp"), "");
});
