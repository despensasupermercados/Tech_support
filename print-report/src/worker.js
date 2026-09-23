// cims-print — press job log: drop page, merge store, report feed.
//
// Mounted at hon.cims.work/print* (route attached once in the Cloudflare
// dashboard). Its own Worker and its own D1: it never reads or writes a HON
// table, so nothing here can break the handover app.
//
// The browser parses the dropped file (public/print/lib/parse.js) and sends
// normalised jobs in chunks — a 5 MB workbook never crosses a ship's link, and a
// dropped connection costs one chunk, not the upload.
//
//   GET  /print/api/health
//   GET  /print/api/summary            ships on file + upload history
//   GET  /print/api/jobs?ship=Pursuit  one ship's jobs, columnar
//   POST /print/api/upload             { fileName, sheet, ship, shipSource, from, to, total } → { id }
//   POST /print/api/upload/:id/chunk   { jobs:[…] } → { sent, added }
//   POST /print/api/upload/:id/finish  → the upload row
//   GET  /print/api/watch              night watch: latest run + last 14
//   GET  /print/api/watch?run=1        run the checks now (never emails)
//
// Everything else under /print is a static asset (public/print/…).

import { FLEET } from "../public/print/lib/parse.js";
import { runWatch } from "./watch.js";
import { sendReminder } from "./remind.js";

export const REMIND_CRON = "0 13 1 * *";

export const VERSION = "2026-09-24c";
const CHUNK_MAX = 500;
const FLEET_SET = new Set(FLEET);
const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
const bad = (msg, status = 400) => json({ error: msg }, status);

const str = (v, max = 300) => (v == null ? null : String(v).slice(0, max));
const intOrNull = (v) => (v == null || v === "" ? null : Number.isFinite(+v) ? Math.round(+v) : null);
const int0 = (v) => intOrNull(v) ?? 0;

// One job from the client → one row, or a reason it was refused.
export function cleanJob(j) {
  if (!j || typeof j !== "object") return { error: "not an object" };
  if (!TS.test(j.endTs || "")) return { error: "bad end time" };
  if (j.startTs != null && !TS.test(j.startTs)) return { error: "bad start time" };
  if (j.acceptTs != null && !TS.test(j.acceptTs)) return { error: "bad accept time" };
  const jobId = intOrNull(j.jobId);
  const no = intOrNull(j.no);
  if (jobId == null || no == null) return { error: "missing Job ID or No." };
  const run = intOrNull(j.runS);
  if (run != null && (run < 0 || run >= 86400)) return { error: "run time out of range" };
  return {
    row: [
      jobId, j.endTs, j.startTs ?? null, j.acceptTs ?? null, run, intOrNull(j.waitS), no,
      str(j.mode, 40), str(j.user, 60), str(j.result, 40), str(j.tray, 40),
      intOrNull(j.pages), intOrNull(j.sheets), intOrNull(j.sets), intOrNull(j.outSets),
      int0(j.color), int0(j.black), int0(j.mono), int0(j.feed), int0(j.exit), int0(j.waste),
      str(j.file),
    ],
  };
}

const INSERT = `INSERT OR IGNORE INTO jobs
  (ship, job_id, end_ts, start_ts, accept_ts, run_s, wait_s, log_no, mode, user, result, tray,
   pages, sheets, sets, out_sets, color, black, mono, feed, exit_n, waste, file, upload_id)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;

async function startUpload(env, b) {
  if (!b || typeof b !== "object") return bad("no body");
  if (!FLEET_SET.has(b.ship)) return bad("Ship not recognised — pick the ship before sending.");
  const src = ["tab", "filename", "picked"].includes(b.shipSource) ? b.shipSource : null;
  if (!src) return bad("ship source missing");
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO uploads (id, file_name, sheet, ship, ship_source, day_from, day_to, started_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(id, str(b.fileName) || "(unnamed)", str(b.sheet), b.ship, src,
    str(b.from, 10), str(b.to, 10), new Date().toISOString()).run();
  return json({ id });
}

async function chunk(env, id, b) {
  const up = await env.DB.prepare("SELECT ship, finished_at FROM uploads WHERE id = ?").bind(id).first();
  if (!up) return bad("unknown upload", 404);
  if (up.finished_at) return bad("upload already finished", 409);
  const jobs = Array.isArray(b?.jobs) ? b.jobs : null;
  if (!jobs || !jobs.length) return bad("no jobs");
  if (jobs.length > CHUNK_MAX) return bad(`at most ${CHUNK_MAX} jobs per chunk`);
  const stmt = env.DB.prepare(INSERT);
  const stmts = [];
  let refused = 0;
  for (const j of jobs) {
    const c = cleanJob(j);
    if (c.error) { refused++; continue; }
    const [jobId, ...rest] = c.row;
    stmts.push(stmt.bind(up.ship, jobId, ...rest, id));
  }
  let added = 0;
  if (stmts.length) {
    const res = await env.DB.batch(stmts);
    for (const r of res) added += r.meta?.changes || 0;
  }
  await env.DB.prepare("UPDATE uploads SET rows_sent = rows_sent + ?, rows_added = rows_added + ? WHERE id = ?")
    .bind(jobs.length, added, id).run();
  return json({ sent: jobs.length, added, refused });
}

async function finish(env, id) {
  await env.DB.prepare("UPDATE uploads SET finished_at = COALESCE(finished_at, ?) WHERE id = ?")
    .bind(new Date().toISOString(), id).run();
  const row = await env.DB.prepare("SELECT * FROM uploads WHERE id = ?").bind(id).first();
  return row ? json(row) : bad("unknown upload", 404);
}

async function summary(env) {
  const ships = await env.DB.prepare(
    `SELECT ship, COUNT(*) AS jobs, MIN(substr(end_ts,1,10)) AS day_from, MAX(substr(end_ts,1,10)) AS day_to
     FROM jobs GROUP BY ship ORDER BY ship`,
  ).all();
  const uploads = await env.DB.prepare(
    `SELECT id, file_name, sheet, ship, ship_source, rows_sent, rows_added, day_from, day_to, started_at, finished_at
     FROM uploads ORDER BY started_at DESC LIMIT 30`,
  ).all();
  return json({ ships: ships.results, uploads: uploads.results });
}

// Columnar with string dictionaries: ~40% of the plain-JSON size, which is what
// a ship on Starlink pays for.
export const COLS = ["job_id", "end_ts", "run_s", "wait_s", "mode", "user", "result", "tray",
  "pages", "sheets", "out_sets", "color", "black", "feed", "waste", "file"];
const DICT = new Set(["mode", "user", "result", "tray", "file"]);

export function columnar(rows) {
  const dicts = {};
  const index = {};
  for (const c of DICT) { dicts[c] = []; index[c] = new Map(); }
  const data = COLS.map(() => []);
  for (const r of rows) {
    COLS.forEach((c, k) => {
      let v = r[c];
      if (DICT.has(c)) {
        const key = v == null ? "" : v;
        let n = index[c].get(key);
        if (n == null) { n = dicts[c].length; dicts[c].push(key); index[c].set(key, n); }
        v = n;
      }
      data[k].push(v);
    });
  }
  return { cols: COLS, dicts, data, n: rows.length };
}

async function jobsFor(env, ship) {
  if (!FLEET_SET.has(ship)) return bad("unknown ship");
  const res = await env.DB.prepare(`SELECT ${COLS.join(",")} FROM jobs WHERE ship = ? ORDER BY end_ts`).bind(ship).all();
  return json({ ship, ...columnar(res.results) });
}

async function watch(env, url) {
  if (url.searchParams.get("run") === "1") return json(await runWatch(env, { trigger: "manual", email: false }));
  const rows = (await env.DB.prepare("SELECT id, ran_at, trigger, status, checks, emailed FROM watch_runs ORDER BY id DESC LIMIT 14").all()).results;
  const runs = rows.map((r) => ({ ...r, checks: JSON.parse(r.checks) }));
  return json({ latest: runs[0] || null, history: runs.map(({ checks, ...r }) => ({ ...r, warn: checks.filter((c) => c.status === "warn").length, fail: checks.filter((c) => c.status === "fail").length })) });
}

export default {
  // Night watch — Cloudflare cron (wrangler.toml [triggers]).
  async scheduled(event, env, ctx) {
    if (event.cron === REMIND_CRON) {
      ctx.waitUntil(sendReminder(env).then((r) => console.log(`[remind] ${JSON.stringify(r)}`)));
      return;
    }
    ctx.waitUntil(runWatch(env, { trigger: "cron", email: true }).then((r) => console.log(`[watch] ${r.status} · ${r.checks.length} checks · emailed ${r.emailed}`)));
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname.replace(/\/+$/, "");
    if (!p.startsWith("/print/api/")) return env.ASSETS.fetch(request);
    try {
      if (p === "/print/api/health") return json({ ok: true, app: "cims-print", version: VERSION });
      if (p === "/print/api/summary" && request.method === "GET") return summary(env);
      if (p === "/print/api/jobs" && request.method === "GET") return jobsFor(env, url.searchParams.get("ship"));
      if (p === "/print/api/watch" && request.method === "GET") return watch(env, url);
      if (p === "/print/api/upload" && request.method === "POST") return startUpload(env, await request.json());
      let m = p.match(/^\/print\/api\/upload\/([0-9a-f-]{36})\/chunk$/);
      if (m && request.method === "POST") return chunk(env, m[1], await request.json());
      m = p.match(/^\/print\/api\/upload\/([0-9a-f-]{36})\/finish$/);
      if (m && request.method === "POST") return finish(env, m[1]);
      return bad("not found", 404);
    } catch (e) {
      return bad(`server error: ${e.message}`, 500);
    }
  },
};
