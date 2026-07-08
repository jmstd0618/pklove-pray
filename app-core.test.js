import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDateRange,
  filterAvailableNames,
  getCapacity,
  isDateFull,
  normalizeRoster,
  getUnregisteredNames,
} from "./app-core.js";

test("buildDateRange excludes selected weekdays", () => {
  const days = buildDateRange("2026-07-01", "2026-07-07", [0, 6]);

  assert.deepEqual(days.map((day) => day.key), [
    "2026-07-01",
    "2026-07-02",
    "2026-07-03",
    "2026-07-06",
    "2026-07-07",
  ]);
});

test("date capacity falls back to default and detects full dates", () => {
  const settings = { defaultCapacity: 2, capacities: { "2026-07-02": 3 } };

  assert.equal(getCapacity(settings, "2026-07-01"), 2);
  assert.equal(getCapacity(settings, "2026-07-02"), 2);
  assert.equal(isDateFull(["김민수", "이서연"], settings, "2026-07-01"), true);
  assert.equal(isDateFull(["김민수", "이서연"], settings, "2026-07-02"), true);
});

test("normalizeRoster removes blanks and duplicates then sorts by Korean name", () => {
  assert.deepEqual(normalizeRoster("박지훈\n김민수\n이서연\n김민수\n\n강하늘"), [
    "강하늘",
    "김민수",
    "박지훈",
    "이서연",
  ]);
});

test("getUnregisteredNames compares roster with registrations", () => {
  const roster = ["김민수", "이서연", "박지훈"];
  const registrations = {
    "2026-07-01": { entries: { a: { name: "김민수" } } },
    "2026-07-02": { entries: { b: { name: "박지훈" } } },
  };

  assert.deepEqual(getUnregisteredNames(roster, registrations), ["이서연"]);
});

test("filterAvailableNames searches roster and excludes registered names", () => {
  const roster = ["강하늘", "김민수", "김지수", "박지훈"];
  const registrations = {
    "2026-07-01": { entries: { a: { name: "김민수" } } },
  };

  assert.deepEqual(filterAvailableNames(roster, registrations, "김"), ["김지수"]);
});

test("filterAvailableNames returns multiple autocomplete candidates", () => {
  const roster = ["정독대", "정민성", "정수연", "최민수"];

  assert.deepEqual(filterAvailableNames(roster, {}, "정"), ["정독대", "정민성", "정수연"]);
});
