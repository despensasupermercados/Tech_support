// Night watch — cims-print's self-check. Runs on Cloudflare's own cron (and on
// demand), holds no token, and asks every night whether the record is still
// telling the truth.
//
//   gather()  — the D1 + asset reads (I/O)
//   assess()  — PURE: facts in, named checks out (tested)
//   runWatch()— gather → assess → store → email when something is NEW
//
// Status per check: ok · info · warn · fail.
//   fail  = something is WRONG: the record is broken (bad timestamps,
//           impossible run times) or the pages are not served. The only status
//           that emails — once when it starts, then at most once every 7 days
//           while it persists.
//   warn  = the record is fine but a person may want to know (a ship gone quiet,
//           a gap in the log, an interrupted upload). Never emailed — shown in
//           the report footer and at /print/api/watch.
//   info  = worth knowing, never emailed.
//
// Miguel, 2026-09-23: "I only need an email if something is wrong. Not daily
// status." A gap in the log is a fact about the ship, not a fault in the app.
//
// Every check names its subject: which ship, which dates, which upload.
//
// No "ship gone quiet" check (removed 2026-09-24, Miguel: "I don't need this
// STALE"). Uploads are monthly, so it fired every month; the reminder to Ohji
// on the 1st (remind.js) already names each ship's missing days.

import { baseline } from "../public/print/lib/metrics.js";
import { category } from "../public/print/lib/classify.js";
import { page, card, shortDate } from "./daylight.js";

export const LIMITS = { gapDays: 7, driftPts: 10, driftMin: 200, unfinishedHours: 2 };

const day = (ts) => ts.slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const between = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fday = (iso) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;

// ---------------------------------------------------------------- PURE
export function assess(f, limits = LIMITS) {
  const checks = [];
  const add = (id, status, title, detail = "") => checks.push({ id, status, title, detail });
  const today = f.today;

  if (!f.ships.length) {
    add("data", "info", "Nothing on file yet", "No press job history has been uploaded.");
  } else {
    const total = f.ships.reduce((a, s) => a + s.n, 0);
    add("data", "ok", `${total.toLocaleString("en-US")} jobs on file`, f.ships.map((s) => `${s.ship} ${s.n.toLocaleString("en-US")} (${fday(day(s.first))} – ${fday(day(s.last))})`).join(" · "));
  }

  // integrity — any of these means a parser or store bug
  const inv = f.invariants || {};
  const bad = [
    ["bad_ts", "end times not in YYYY-MM-DD HH:MM:SS"],
    ["start_run_mismatch", "jobs with a start time but no run time, or the reverse"],
    ["bad_run", "run times below 0 or a full day or more"],
    ["start_after_end", "jobs that start after they end"],
    ["future", "jobs dated in the future"],
    ["ancient", "jobs dated before 2020"],
    ["negative", "negative sheet or click counts"],
  ].filter(([k]) => (inv[k] || 0) > 0);
  if (bad.length) add("integrity", "fail", "The record has impossible rows", bad.map(([k, t]) => `${inv[k]} ${t}`).join(" · "));
  else if (f.ships.length) add("integrity", "ok", "Every row passes the integrity rules");
  if ((inv.complete_never_ran || 0) > 0) add("complete_never_ran", "info", `${inv.complete_never_ran} completed jobs have no run time`, "The press logged Complete with a 00:00:00 start and no paper fed. Left out of every hour count.");

  // gaps inside the log
  for (const [ship, days] of Object.entries(f.daysByShip || {})) {
    for (let i = 1; i < days.length; i++) {
      const g = between(days[i - 1], days[i]) - 1;
      if (g >= limits.gapDays) add(`gap:${ship}:${days[i - 1]}`, "warn", `${ship}: no jobs logged for ${g} days`, `${fday(addDays(days[i - 1], 1))} – ${fday(addDays(days[i], -1))}. Dry dock, or a missing export — the log cannot say which.`);
    }
  }

  // interrupted uploads
  for (const u of f.unfinished || []) add(`upload:${u.id}`, "warn", `Upload stopped part-way: ${u.ship}`, `"${u.file_name}", started ${u.started_at.slice(0, 16).replace("T", " ")} UTC, ${u.rows_sent.toLocaleString("en-US")} jobs received. Dropping the file again finishes it; nothing is counted twice.`);

  // the stalled-time yardstick
  for (const [ship, b] of Object.entries(f.baselines || {})) {
    if (!b) add(`base:${ship}`, "info", `${ship}: not enough history for a normal speed`, "Its time is not split into printing and stalled until more completed jobs are on file.");
    else if (b.setupS < 10 || b.setupS > 300 || b.secPerSheet < 1 || b.secPerSheet > 15)
      add(`base:${ship}`, "warn", `${ship}: normal speed looks wrong`, `Measured ${Math.round(b.setupS)} s setup + ${b.secPerSheet.toFixed(1)} s a sheet; expected 10–300 s and 1–15 s. Stalled time for ${ship} is not trustworthy until this is explained.`);
  }

  // file names the classifier no longer recognises
  if (f.drift && f.drift.recentN >= limits.driftMin) {
    const d = f.drift.recentOther - f.drift.allOther;
    if (d >= limits.driftPts) add("drift", "warn", `"Other" jumped to ${Math.round(f.drift.recentOther)}% of recent jobs`, `It is ${Math.round(f.drift.allOther)}% across everything on file. New file names are not being recognised — the document types need a new rule.`);
  }

  // the same Job ID twice on one ship, close together — the parser read one job two ways
  for (const c of f.collisions || []) add(`dup:${c.ship}:${c.job_id}`, "warn", `${c.ship}: Job ID ${c.job_id} stored ${c.c} times`, `Between ${c.a} and ${c.b}. The export format may have changed.`);

  // the pages people open
  for (const a of f.assets || []) if (!a.ok) add(`asset:${a.path}`, "fail", `Page not served: ${a.path}`, a.detail);
  if ((f.assets || []).length && f.assets.every((a) => a.ok)) add("assets", "ok", "Upload page, report and scripts all served");

  const status = checks.some((c) => c.status === "fail") ? "fail" : checks.some((c) => c.status === "warn") ? "warn" : "ok";
  return { status, checks };
}

// What goes in the email: only fails, and a fail only if it has not been
// emailed in the last REMIND_DAYS. `sentBefore` maps check id → ISO time it was
// last emailed.
export const REMIND_DAYS = 7;
export function toSend(result, sentBefore = {}, now = new Date()) {
  return result.checks.filter((c) => {
    if (c.status !== "fail") return false;
    const last = sentBefore[c.id];
    return !last || now - new Date(last) >= REMIND_DAYS * 86400000;
  });
}

// ---------------------------------------------------------------- I/O
export async function gather(env, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const DB = env.DB;
  // Dates come from VALID stamps only: one malformed row must be counted by the
  // integrity check, never crash the date maths for everything else.
  const VALID = "length(end_ts) = 19 AND datetime(end_ts) = end_ts";
  const ships = (await DB.prepare(`SELECT ship, COUNT(*) AS n, MIN(CASE WHEN ${VALID} THEN end_ts END) AS first, MAX(CASE WHEN ${VALID} THEN end_ts END) AS last FROM jobs GROUP BY ship ORDER BY ship`).all()).results.filter((s) => s.first);
  const tomorrow = addDays(today, 1) + " 23:59:59";
  const invariants = await DB.prepare(`SELECT
    -- D1 refuses long GLOB/LIKE patterns ("pattern too complex") where local
    -- SQLite accepts them — found live 2026-09-23. datetime() is NULL for any
    -- invalid stamp; length pins the exact 'YYYY-MM-DD HH:MM:SS' shape.
    SUM(CASE WHEN length(end_ts) <> 19 OR datetime(end_ts) IS NULL OR datetime(end_ts) <> end_ts THEN 1 ELSE 0 END) AS bad_ts,
    SUM(CASE WHEN (start_ts IS NULL) <> (run_s IS NULL) THEN 1 ELSE 0 END) AS start_run_mismatch,
    SUM(CASE WHEN run_s IS NOT NULL AND (run_s < 0 OR run_s >= 86400) THEN 1 ELSE 0 END) AS bad_run,
    SUM(CASE WHEN start_ts IS NOT NULL AND start_ts > end_ts THEN 1 ELSE 0 END) AS start_after_end,
    SUM(CASE WHEN end_ts > ? THEN 1 ELSE 0 END) AS future,
    SUM(CASE WHEN end_ts < '2020-01-01' THEN 1 ELSE 0 END) AS ancient,
    SUM(CASE WHEN feed < 0 OR color < 0 OR black < 0 OR waste < 0 THEN 1 ELSE 0 END) AS negative,
    SUM(CASE WHEN result = 'Complete' AND run_s IS NULL THEN 1 ELSE 0 END) AS complete_never_ran
    FROM jobs`).bind(tomorrow).first();
  const dayRows = (await DB.prepare(`SELECT ship, substr(end_ts,1,10) AS d FROM jobs WHERE ${VALID} GROUP BY ship, d ORDER BY ship, d`).all()).results;
  const daysByShip = {};
  for (const r of dayRows) (daysByShip[r.ship] ||= []).push(r.d);
  const cutoff = new Date(now.getTime() - LIMITS.unfinishedHours * 3600000).toISOString();
  const unfinished = (await DB.prepare("SELECT id, ship, file_name, started_at, rows_sent FROM uploads WHERE finished_at IS NULL AND started_at < ?").bind(cutoff).all()).results;
  const runRows = (await DB.prepare("SELECT ship, run_s, feed FROM jobs WHERE result = 'Complete' AND mode = 'Print' AND run_s > 0 AND (feed <= 2 OR feed >= 50)").all()).results;
  const byShip = {};
  for (const r of runRows) (byShip[r.ship] ||= []).push({ result: "Complete", mode: "Print", runS: r.run_s, feed: r.feed });
  const baselines = {};
  for (const s of ships) baselines[s.ship] = baseline(byShip[s.ship] || []);
  // drift: "Other" share over the last 30 days of data vs everything
  let drift = null;
  const lastDay = ships.length ? ships.map((s) => day(s.last)).sort().pop() : null;
  if (lastDay) {
    const since = addDays(lastDay, -29);
    const groups = (await DB.prepare("SELECT file, mode, user, COUNT(*) AS n, SUM(CASE WHEN end_ts >= ? THEN 1 ELSE 0 END) AS recent FROM jobs GROUP BY file, mode, user").bind(since).all()).results;
    let all = 0, allO = 0, rec = 0, recO = 0;
    for (const g of groups) {
      const other = category({ file: g.file, mode: g.mode, user: g.user }) === "Other";
      all += g.n; rec += g.recent; if (other) { allO += g.n; recO += g.recent; }
    }
    drift = { allOther: all ? (100 * allO) / all : 0, recentOther: rec ? (100 * recO) / rec : 0, recentN: rec };
  }
  const collisions = (await DB.prepare(`SELECT ship, job_id, COUNT(*) AS c, MIN(end_ts) AS a, MAX(end_ts) AS b FROM jobs
    GROUP BY ship, job_id HAVING c > 1 AND julianday(MAX(end_ts)) - julianday(MIN(end_ts)) < 30 LIMIT 20`).all()).results;
  const assets = [];
  if (env.ASSETS) {
    for (const [path, marker] of [["/print/", "Drop the press job history"], ["/print/report", "Print report"], ["/print/lib/parse.js", "parseWorkbook"], ["/print/lib/insights.js", "export function insights"], ["/print/vendor/echarts.min.js", null], ["/print/vendor/xlsx.full.min.js", null]]) {
      try {
        const r = await env.ASSETS.fetch(new Request(`https://hon.cims.work${path}`));
        const body = marker ? await r.text() : "";
        const ok = r.status === 200 && (!marker || body.includes(marker));
        assets.push({ path, ok, detail: ok ? "" : `HTTP ${r.status}${marker && r.status === 200 ? `, missing "${marker}"` : ""}` });
      } catch (e) { assets.push({ path, ok: false, detail: e.message }); }
    }
  }
  return { today, ships, invariants, daysByShip, unfinished, baselines, drift, collisions, assets };
}

const WORD = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
const word = (n) => WORD[n] || String(n);

// Daylight layout (cims-email-standard §9): the headline says the answer, one card per problem.
export function alertEmail(items, result, origin = "https://hon.cims.work", now = new Date()) {
  const fails = items.filter((c) => c.status === "fail").length;
  const subject = `Print report · something is wrong · ${items[0].title}`.slice(0, 160);
  const label = { fail: "PROBLEM", warn: "NEW" };
  const checks = (result && Array.isArray(result.checks)) ? result.checks : items;
  const n = (st) => checks.filter((c) => c.status === st).length;
  const failN = n("fail"), warnN = n("warn"), okN = n("ok");
  const headline = [
    `${word(fails)} ${fails === 1 ? "problem" : "problems"} in the print report.`,
    warnN ? `${word(warnN)} more to watch.` : "Everything else passed.",
  ];
  const cards = items.map((c, i) => card({
    title: c.title,
    pill: c.status === "fail" ? "Problem" : "New",
    tone: c.status === "fail" ? "red" : "amber",
    note: c.detail,
    first: i === 0,
  })).join("");
  const html = page({
    preheader: `${headline[0]} ${items[0].title}`,
    eyebrow: "PRINT REPORT · NIGHT WATCH",
    date: shortDate(now),
    headline,
    lead: "You get this email only when something is wrong. If it is still wrong in 7 days you will hear once more.",
    stats: [
      { n: failN, label: "Problems", tone: "red" },
      { n: warnN, label: "To watch", tone: "amber" },
      { n: okN, label: "Passed", tone: "green" },
    ],
    body: cards,
    footer: [`Report: ${origin}/print/report`, `All checks, latest run: ${origin}/print/api/watch`, "Sent by the nightly self-check at 06:15 UTC."],
  });
  const text = [`Print report — night watch`, "", ...items.map((c) => `[${label[c.status]}] ${c.title}${c.detail ? `\n   ${c.detail}` : ""}`), "", `Report: ${origin}/print/report`, `All checks: ${origin}/print/api/watch`].join("\n");
  return { subject, html, text };
}

export async function runWatch(env, { trigger = "manual", email = trigger === "cron", now = new Date() } = {}) {
  let result;
  try { result = assess(await gather(env, now)); }
  catch (e) { result = { status: "fail", checks: [{ id: "watch", status: "fail", title: "The night watch itself failed", detail: e.message }] }; }
  // when each fail was last emailed (sent = JSON array of check ids)
  const sentRows = (await env.DB.prepare("SELECT ran_at, sent FROM watch_runs WHERE sent IS NOT NULL AND ran_at >= ? ORDER BY id DESC").bind(new Date(now.getTime() - REMIND_DAYS * 86400000).toISOString()).all().catch(() => ({ results: [] }))).results || [];
  const sentBefore = {};
  for (const r of sentRows) for (const id of JSON.parse(r.sent || "[]")) sentBefore[id] ||= r.ran_at;
  const items = toSend(result, sentBefore, now);
  let emailed = 0;
  if (email && items.length && env.MAILER) {
    const to = String(env.WATCH_ALERT_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (to.length) {
      const m = alertEmail(items, result, undefined, now);
      const res = await env.MAILER.fetch("https://mailer/send", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          app: "cims-print", templateId: "print.watch.v1",
          idempotencyKey: `print-watch-${now.toISOString().slice(0, 10)}-${items.map((c) => c.id).join("|")}`.slice(0, 200),
          from: "CIMS <cims@cims.work>", to, subject: m.subject, html: m.html, text: m.text,
          critical: items.some((c) => c.status === "fail"),
        }),
      }).catch(() => null);
      emailed = res && res.ok ? 1 : 0;
    }
  }
  await env.DB.prepare("INSERT INTO watch_runs (ran_at, trigger, status, checks, emailed, sent) VALUES (?,?,?,?,?,?)")
    .bind(now.toISOString(), trigger, result.status, JSON.stringify(result.checks), emailed, emailed ? JSON.stringify(items.map((c) => c.id)) : null).run().catch(() => {});
  return { ...result, ran_at: now.toISOString(), trigger, emailed, sent: items.map((c) => c.id) };
}
