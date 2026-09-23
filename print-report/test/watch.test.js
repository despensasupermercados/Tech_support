import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { assess, toSend, alertEmail, runWatch } from "../src/watch.js";
import worker from "../src/worker.js";
import { makeD1 } from "./helpers/d1.js";

const base = { today: "2026-09-23", ships: [{ ship: "Quest", n: 10, first: "2026-01-01 08:00:00", last: "2026-09-21 10:00:00" }], invariants: {}, daysByShip: {}, unfinished: [], baselines: { Quest: { setupS: 50, secPerSheet: 3.8 } }, drift: null, collisions: [], assets: [] };

test("a clean record passes", () => {
  const r = assess(base);
  assert.equal(r.status, "ok");
});

test("an impossible row fails and says how many", () => {
  const r = assess({ ...base, invariants: { bad_run: 3 } });
  assert.equal(r.status, "fail");
  assert.match(r.checks.find((c) => c.id === "integrity").detail, /^3 run times/);
});

test("a ship gone quiet is named, with its last day", () => {
  const r = assess({ ...base, today: "2026-10-20" });
  const c = r.checks.find((x) => x.id === "stale:Quest");
  assert.equal(c.status, "warn");
  assert.match(c.title, /Quest: no jobs after 21 Sep 2026/);
});

test("a gap names the missing dates — Onward's real 23 days", () => {
  const r = assess({ ...base, daysByShip: { Onward: ["2026-08-14", "2026-09-07"] } });
  const c = r.checks.find((x) => x.id.startsWith("gap:Onward"));
  assert.match(c.title, /23 days/);
  assert.match(c.detail, /15 Aug 2026 – 6 Sep 2026/);
});

test("a warn is emailed once, a fail every time", () => {
  const r = assess({ ...base, daysByShip: { Onward: ["2026-08-14", "2026-09-07"] }, invariants: { future: 1 } });
  const first = toSend(r, []);
  assert.deepEqual(first.map((c) => c.status).sort(), ["fail", "warn"]);
  const second = toSend(r, r.checks);
  assert.deepEqual(second.map((c) => c.status), ["fail"]);
});

test("a normal speed outside the plausible band is flagged, not trusted", () => {
  const r = assess({ ...base, baselines: { Quest: { setupS: 900, secPerSheet: 3 } } });
  assert.equal(r.checks.find((c) => c.id === "base:Quest").status, "warn");
});

test("classifier drift warns only with enough recent jobs", () => {
  assert.equal(assess({ ...base, drift: { allOther: 24, recentOther: 40, recentN: 500 } }).checks.find((c) => c.id === "drift").status, "warn");
  assert.equal(assess({ ...base, drift: { allOther: 24, recentOther: 40, recentN: 50 } }).checks.find((c) => c.id === "drift"), undefined);
});

test("the alert email carries the one letterhead and no rgba or gradient", () => {
  const m = alertEmail([{ id: "x", status: "fail", title: "Page not served: /print/", detail: "HTTP 500" }], {});
  assert.match(m.html, /CRUISE INDUSTRY MANAGED SERVICES/);
  assert.doesNotMatch(m.html, /rgba\(|linear-gradient/);
  assert.match(m.subject, /1 problem/);
  assert.match(m.text, /\[PROBLEM\] Page not served/);
});

test("cims-mast.js is byte-identical to the estate letterhead", () => {
  const buf = readFileSync(new URL("../src/cims-mast.js", import.meta.url));
  const sha = createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
  assert.equal(sha, "1898be3164df1a9a84f8b7613f61145c272b9da6");
});

test("end to end on D1: runs, stores, and emails the new items once", async () => {
  const DB = makeD1();
  const sent = [];
  const env = { DB, WATCH_ALERT_TO: "a@b.co", MAILER: { fetch: async (u, o) => { sent.push(JSON.parse(o.body)); return new Response("{}"); } } };
  DB.raw.exec(`INSERT INTO jobs (ship, job_id, end_ts, start_ts, run_s, log_no, mode, user, result, feed, upload_id) VALUES
    ('Onward', 1, '2026-08-14 10:00:00', '2026-08-14 09:59:00', 60, 1, 'Print', 'Insider', 'Complete', 1, 'u'),
    ('Onward', 2, '2026-09-07 10:00:00', '2026-09-07 09:59:00', 60, 2, 'Print', 'Insider', 'Complete', 1, 'u')`);
  const now = new Date("2026-09-10T06:15:00Z");
  const a = await runWatch(env, { trigger: "cron", now });
  assert.equal(a.status, "warn");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].app, "cims-print");
  assert.equal(sent[0].from, "CIMS <cims@cims.work>");
  await runWatch(env, { trigger: "cron", now: new Date("2026-09-11T06:15:00Z") });
  assert.equal(sent.length, 1, "the same gap is not emailed twice");
  const r = await worker.fetch(new Request("https://hon.cims.work/print/api/watch"), { ...env, ASSETS: { fetch: async () => new Response("") } });
  const body = await r.json();
  assert.equal(body.history.length, 2);
  assert.ok(body.latest.checks.some((c) => c.id.startsWith("gap:Onward")));
});
