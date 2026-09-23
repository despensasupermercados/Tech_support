import { test } from "node:test";
import assert from "node:assert/strict";
import { reportMonth, monthStatus, reminderEmail, sendReminder } from "../src/remind.js";
import worker, { REMIND_CRON } from "../src/worker.js";
import { makeD1 } from "./helpers/d1.js";

const ships = [{ ship: "Journey", last: "2026-09-21 09:00:00" }, { ship: "Pursuit", last: "2026-09-30 23:10:00" }, { ship: "Quest", last: "2026-08-12 10:00:00" }];

test("on 1 Oct the reminder is about September", () => {
  assert.deepEqual(reportMonth(new Date("2026-10-01T13:00:00Z")), { key: "2026-09", from: "2026-09-01", to: "2026-09-30", name: "September 2026" });
  assert.equal(reportMonth(new Date("2027-01-01T13:00:00Z")).name, "December 2026");
});

test("each ship: complete, or exactly the days still missing", () => {
  const r = monthStatus(ships, reportMonth(new Date("2026-10-01T13:00:00Z")));
  assert.deepEqual(r.map((x) => x.done ? "done" : x.need), ["22 Sep 2026 – 30 Sep 2026", "done", "1 Sep 2026 – 30 Sep 2026"]);
});

test("the email names the month, the ships and the address as plain text", () => {
  const m = reminderEmail(ships, new Date("2026-10-01T13:00:00Z"));
  assert.match(m.subject, /September 2026.*2 of 3 ships/);
  assert.match(m.html, /hon\.cims\.work\/print</);
  assert.doesNotMatch(m.html, /<a\s|rgba\(|linear-gradient/);
  assert.match(m.html, /CRUISE INDUSTRY MANAGED SERVICES/);
});

test("all complete → a short 'nothing to do' email, no steps", () => {
  const m = reminderEmail([{ ship: "Pursuit", last: "2026-09-30 23:00:00" }], new Date("2026-10-01T13:00:00Z"));
  assert.match(m.subject, /complete for all 1 ships/);
  assert.doesNotMatch(m.html, /Export the/);
});

test("off until switched on; then one email a month, to the configured person", async () => {
  const DB = makeD1(); const sent = [];
  DB.raw.exec(`INSERT INTO jobs (ship, job_id, end_ts, log_no, result, upload_id) VALUES ('Quest', 1, '2026-09-21 10:00:00', 1, 'Cancel', 'u')`);
  const env = { DB, REMIND_TO: "Ohji.Miranda@dg3.com", MAILER: { fetch: async (u, o) => { sent.push(JSON.parse(o.body)); return new Response("{}"); } } };
  assert.ok((await sendReminder(env, new Date("2026-10-01T13:00:00Z"))).skipped);
  assert.equal(sent.length, 0);
  await sendReminder({ ...env, REMIND_ENABLED: "1" }, new Date("2026-10-01T13:00:00Z"));
  assert.deepEqual(sent[0].to, ["Ohji.Miranda@dg3.com"]);
  assert.equal(sent[0].idempotencyKey, "print-remind-2026-09");
});

test("the 1st-of-month cron sends the reminder, not the night watch", async () => {
  const DB = makeD1(); const sent = []; const waits = [];
  DB.raw.exec(`INSERT INTO jobs (ship, job_id, end_ts, log_no, result, upload_id) VALUES ('Quest', 1, '2026-09-21 10:00:00', 1, 'Cancel', 'u')`);
  const env = { DB, REMIND_TO: "o@dg3.com", REMIND_ENABLED: "1", MAILER: { fetch: async (u, o) => { sent.push(JSON.parse(o.body)); return new Response("{}"); } } };
  await worker.scheduled({ cron: REMIND_CRON }, env, { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].templateId, "print.remind.v1");
  assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM watch_runs").first()).n, 0);
});
