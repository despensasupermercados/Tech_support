import { test } from "node:test";
import assert from "node:assert/strict";
import { insights, periodOf, periodRange, shiftPeriod, periodLabel, coverage } from "../public/print/lib/insights.js";

test("periods: ISO weeks start Monday; months and years roll over", () => {
  assert.equal(periodOf("2026-09-20", "week"), "2026-09-14");
  assert.deepEqual(periodRange("2026-02", "month"), ["2026-02-01", "2026-02-28"]);
  assert.equal(shiftPeriod("2026-01", "month", -1), "2025-12");
  assert.equal(shiftPeriod("2026-09-14", "week", 1), "2026-09-21");
  assert.equal(periodLabel("2026-09-18", "day"), "Fri 18 Sep 2026");
});

test("a period cut by the data is marked partial, with its day count", () => {
  assert.deepEqual(coverage("2026-09", "month", "2026-01-01", "2026-09-21"), { from: "2026-09-01", to: "2026-09-21", days: 21, of: 30, partial: true });
});

const J = (ship, endTs, runS, extra = {}) => ({ ship, endTs, day: endTs.slice(0, 10), runS, startMs: Date.parse(endTs.replace(" ", "T") + "Z") - runS * 1000, feed: 10, color: 10, black: 0, waste: 0, result: "Complete", mode: "Print", dept: "Insider", cat: "Menus", key: "menu", stallS: 0, ...extra });

test("no previous period → no comparison line, never a zero", () => {
  const r = insights({ jobs: [J("Quest", "2026-01-05 10:00:00", 3600)], key: "2026-01", grain: "month", bases: { Quest: { setupS: 50, secPerSheet: 4 } }, dayMin: "2026-01-01", dayMax: "2026-01-31" });
  const busy = r.cards.find((c) => c.id === "busy");
  assert.doesNotMatch(busy.html, /last month/);
});

test("month over month is stated, and the department that moved is named", () => {
  const jobs = [J("Quest", "2026-01-05 10:00:00", 3600), J("Quest", "2026-02-05 10:00:00", 3 * 3600, { dept: "Shorex" }), J("Quest", "2026-02-06 10:00:00", 3600)];
  const r = insights({ jobs, key: "2026-02", grain: "month", bases: { Quest: { setupS: 50, secPerSheet: 4 } }, dayMin: "2026-01-01", dayMax: "2026-02-28" });
  assert.match(r.cards.find((c) => c.id === "busy").html, /300% more than last month/);
  assert.match(r.cards.find((c) => c.id === "dept").html, /Shorex<\/b> up 3 h/);
});

test("a ship with no yardstick gets no stalled card", () => {
  const r = insights({ jobs: [J("Quest", "2026-01-05 10:00:00", 3600)], key: "2026-01", grain: "month", bases: {}, dayMin: "2026-01-01", dayMax: "2026-01-31" });
  assert.equal(r.cards.find((c) => c.id === "stall"), undefined);
});

test("an empty period says so", () => {
  const r = insights({ jobs: [J("Quest", "2026-01-05 10:00:00", 60)], key: "2026-03", grain: "month", bases: {}, dayMin: "2026-01-01", dayMax: "2026-03-31" });
  assert.equal(r.empty, true);
});

test("a partly-on-file period is compared per day, never as a collapse", () => {
  // 10 days of a 30-day month at 1 h/day vs a full previous month at 1 h/day = flat per day
  const jobs = [];
  for (let d = 1; d <= 31; d++) jobs.push(J("Quest", `2026-08-${String(d).padStart(2, "0")} 10:00:00`, 3600));
  for (let d = 1; d <= 10; d++) jobs.push(J("Quest", `2026-09-${String(d).padStart(2, "0")} 10:00:00`, 3600));
  const r = insights({ jobs, key: "2026-09", grain: "month", bases: { Quest: { setupS: 50, secPerSheet: 4 } }, dayMin: "2026-08-01", dayMax: "2026-09-10" });
  const busy = r.cards.find((c) => c.id === "busy");
  assert.equal(busy.g.delta.dir, "flat");
  assert.equal(busy.g.perDay, true);
  assert.match(busy.html, /the same per day as last month/);
  assert.equal(busy.g.badge, "10/30 days");
});
