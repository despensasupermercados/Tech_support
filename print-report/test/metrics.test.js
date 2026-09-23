import { test } from "node:test";
import assert from "node:assert/strict";
import { baseline, split, busyIntervals, spreadByHour, dur, TOLERANCE, MIN_SAMPLE, billed } from "../public/print/lib/metrics.js";

const J = (endTs, runS, feed, extra = {}) => ({ endTs, runS, feed, result: "Complete", mode: "Print", color: 0, black: 0, ...extra });

function history() {
  const out = [];
  for (let i = 0; i < MIN_SAMPLE; i++) out.push(J("2026-01-01 10:00:00", 50, 1));
  for (let i = 0; i < MIN_SAMPLE; i++) out.push(J("2026-01-01 11:00:00", 50 + 4 * 100, 100));
  return out;
}

test("yardstick = setup + seconds per sheet, from the ship's own history", () => {
  const b = baseline(history());
  assert.equal(b.setupS, 50);
  assert.equal(b.secPerSheet, 4);
});

test("too little history → no yardstick, and the split says unknown, not zero", () => {
  assert.equal(baseline(history().slice(0, 5)), null);
  assert.deepEqual(split(J("2026-01-01 10:00:00", 900, 10), null), { printS: 900, stallS: null });
});

test("printing up to the tolerance, stalled beyond it", () => {
  const b = { setupS: 50, secPerSheet: 4 };
  // 600 sheets: normal 2450 s, allowed 3675 s; ran 37800 s (10.5 h)
  const r = split(J("2026-09-14 19:57:29", 37800, 600), b);
  assert.equal(r.printS, TOLERANCE * 2450);
  assert.equal(r.stallS, 37800 - TOLERANCE * 2450);
  assert.deepEqual(split(J("2026-01-01 10:00:00", 100, 10), b), { printS: 100, stallS: 0 });
});

test("a job that never ran contributes nothing", () => {
  assert.deepEqual(split({ runS: null, feed: 0 }, { setupS: 50, secPerSheet: 4 }), { printS: 0, stallS: 0 });
});

test("overlapping jobs are counted once in busy time", () => {
  const iv = busyIntervals([J("2026-01-01 10:10:00", 600, 1), J("2026-01-01 10:05:00", 600, 1), J("2026-01-01 12:00:00", 60, 1)]);
  const secs = iv.reduce((a, [x, y]) => a + (y - x) / 1000, 0);
  assert.equal(secs, 15 * 60 + 60); // 09:55–10:10 plus 11:59–12:00
});

test("busy time crossing midnight lands on both days", () => {
  const days = {};
  spreadByHour(busyIntervals([J("2026-09-19 00:04:32", 505, 180)]), (d, wd, h, s) => { days[d] = (days[d] || 0) + s; });
  assert.deepEqual(days, { "2026-09-18": 233, "2026-09-19": 272 });
});

test("durations are whole units", () => {
  assert.equal(dur(45), "45 s");
  assert.equal(dur(2280), "38 min");
  assert.equal(dur(7500), "2 h 05 min");
  assert.equal(dur(null), "—");
});

test("billed value uses the 2026 Azamara production rates", () => {
  assert.equal(Math.round(billed({ color: 1000, black: 1000 }) * 1000) / 1000, 36.08);
});

test("printing + stalled = busy, even with overlapping jobs", async () => {
  const { printIntervals } = await import("../public/print/lib/metrics.js");
  const b = { setupS: 50, secPerSheet: 4 };
  const jobs = [J("2026-01-01 12:00:00", 7200, 100), J("2026-01-01 10:30:00", 600, 10), J("2026-01-01 10:40:00", 300, 10)];
  const sum = (iv) => iv.reduce((a, [x, y]) => a + (y - x) / 1000, 0);
  const busy = sum(busyIntervals(jobs));
  const printing = sum(printIntervals(jobs, b));
  assert.ok(printing <= busy);
  // 10:00–12:00 busy. Printing: the 100-sheet job's first 675 s (1.5 × 450),
  // plus the two 10-sheet jobs' 135 s each, which ran inside the long job's
  // stalled tail — the press WAS printing then, so that time is printing.
  assert.equal(busy, 7200);
  assert.equal(busy - printing, 7200 - 675 - 135 - 135);
});

test("working day: window, busy, idle, and a job across midnight on both days", async () => {
  const { dayProfiles } = await import("../public/print/lib/metrics.js");
  const b = { setupS: 50, secPerSheet: 4 };
  // 08:00–09:00 and 14:00–14:30 on the 1st; 23:50→00:10 across midnight
  const days = dayProfiles([J("2026-01-01 09:00:00", 3600, 800), J("2026-01-01 14:30:00", 1800, 400), J("2026-01-02 00:10:00", 1200, 280)], b);
  const d1 = days["2026-01-01"];
  assert.equal(d1.first, 8 * 3600);
  assert.equal(d1.last, 24 * 3600);
  assert.equal(d1.busy, 3600 + 1800 + 600);
  assert.equal(d1.idle, d1.window - d1.busy);
  assert.equal(days["2026-01-02"].busy, 600);
  assert.equal(days["2026-01-02"].first, 0);
});

test("paper: 11×17 from the fold tray at 2,500 a box, 8.5×11 at 5,000, 40 boxes a pallet", async () => {
  const { paper } = await import("../public/print/lib/metrics.js");
  const p = paper([{ tray: "FS Fold", feed: 5000 }, { tray: "FS/OT Main", feed: 10000, result: "Cancel" }]);
  assert.equal(p.tabloidBoxes, 2);
  assert.equal(p.letterBoxes, 2, "cancelled jobs still used paper");
  assert.equal(p.pallets, 4 / 40);
});
