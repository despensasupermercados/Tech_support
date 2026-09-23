// Night watch — cims-print's self-check. Runs on Cloudflare's own cron (and on
// demand), holds no token, and asks every night whether the record is still
// telling the truth.
//
//   gather()  — the D1 + asset reads (I/O)
//   assess()  — PURE: facts in, named checks out (tested)
//   runWatch()— gather → assess → store → email when something is NEW
//
// Status per check: ok · info · warn · fail.
//   fail  = the record itself is broken (bad timestamps, impossible run times,
//           pages not served). Emailed every day it persists.
//   warn  = the record is fine but something needs a person (a ship gone quiet,
//           a gap in the log, an interrupted upload). Emailed ONCE, when it first
//           appears — a gap does not nag nightly.
//   info  = worth knowing, never emailed.
//
// Every check names its subject: which ship, which dates, which upload. Never
// "a ship is stale".

import { baseline } from "../public/print/lib/metrics.js";
import { category } from "../public/print/lib/classify.js";
import { mast } from "./cims-mast.js";

export const LIMITS = { staleDays: 14, gapDays: 7, driftPts: 10, driftMin: 200, unfinishedHours: 2 };

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

  // ships gone quiet
  for (const s of f.ships) {
    const age = between(day(s.last), today);
    if (age > limits.staleDays) add(`stale:${s.ship}`, "warn", `${s.ship}: no jobs after ${fday(day(s.last))}`, `${age} days without a newer upload. Drop the latest job history for ${s.ship}.`);
  }

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

// What goes in the email: every fail, and only warns that are new since last run.
export function toSend(result, previousChecks = []) {
  const before = new Set(previousChecks.filter((c) => c.status === "warn").map((c) => c.id));
  return result.checks.filter((c) => c.status === "fail" || (c.status === "warn" && !before.has(c.id)));
}

// ---------------------------------------------------------------- I/O
export async function gather(env, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const DB = env.DB;
  const ships = (await DB.prepare("SELECT ship, COUNT(*) AS n, MIN(end_ts) AS first, MAX(end_ts) AS last FROM jobs GROUP BY ship ORDER BY ship").all()).results;
  const tomorrow = addDays(today, 1) + " 23:59:59";
  const invariants = await DB.prepare(`SELECT
    SUM(CASE WHEN end_ts NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9] [0-2][0-9]:[0-5][0-9]:[0-5][0-9]' THEN 1 ELSE 0 END) AS bad_ts,
    SUM(CASE WHEN (start_ts IS NULL) <> (run_s IS NULL) THEN 1 ELSE 0 END) AS start_run_mismatch,
    SUM(CASE WHEN run_s IS NOT NULL AND (run_s < 0 OR run_s >= 86400) THEN 1 ELSE 0 END) AS bad_run,
    SUM(CASE WHEN start_ts IS NOT NULL AND start_ts > end_ts THEN 1 ELSE 0 END) AS start_after_end,
    SUM(CASE WHEN end_ts > ? THEN 1 ELSE 0 END) AS future,
    SUM(CASE WHEN end_ts < '2020-01-01' THEN 1 ELSE 0 END) AS ancient,
    SUM(CASE WHEN feed < 0 OR color < 0 OR black < 0 OR waste < 0 THEN 1 ELSE 0 END) AS negative,
    SUM(CASE WHEN result = 'Complete' AND run_s IS NULL THEN 1 ELSE 0 END) AS complete_never_ran
    FROM jobs`).bind(tomorrow).first();
  const dayRows = (await DB.prepare("SELECT ship, substr(end_ts,1,10) AS d FROM jobs GROUP BY ship, d ORDER BY ship, d").all()).results;
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

export function alertEmail(items, result, origin = "https://hon.cims.work") {
  const fails = items.filter((c) => c.status === "fail").length;
  const subject = `Print report night watch · ${fails ? `${fails} problem${fails > 1 ? "s" : ""}` : `${items.length} new item${items.length > 1 ? "s" : ""}`} · ${items[0].title}`.slice(0, 160);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const color = { fail: "#96281B", warn: "#B7791F" };
  const label = { fail: "PROBLEM", warn: "NEW" };
  const rows = items.map((c) => `<tr><td style="padding:10px 0;border-top:1px solid #E5E7EB;font-family:Helvetica,Arial,sans-serif;">
    <div style="font-size:10px;font-weight:700;letter-spacing:1.2px;color:${color[c.status]};">${label[c.status]}</div>
    <div style="font-size:15px;font-weight:600;color:#1B3A5C;margin-top:2px;">${esc(c.title)}</div>
    ${c.detail ? `<div style="font-size:13px;color:#374151;margin-top:3px;line-height:1.45;">${esc(c.detail)}</div>` : ""}</td></tr>`).join("");
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F4F6" style="background:#F3F4F6;"><tr><td align="center" style="padding:16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;max-width:600px;">
  <tr><td style="padding:0;">${mast()}</td></tr>
  <tr><td style="padding:22px 24px 6px;font-family:Helvetica,Arial,sans-serif;">
    <div style="font-size:18px;font-weight:700;color:#1B3A5C;">Print report — night watch</div>
    <div style="font-size:13px;color:#6B7280;margin-top:4px;">What the nightly self-check found. Items already reported are not repeated.</div>
  </td></tr>
  <tr><td style="padding:6px 24px 8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>
  <tr><td style="padding:10px 24px 24px;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#6B7280;">
    Report: ${origin}/print/report<br>All checks, latest run: ${origin}/print/api/watch</td></tr>
  </table></td></tr></table>`;
  const text = [`Print report — night watch`, "", ...items.map((c) => `[${label[c.status]}] ${c.title}${c.detail ? `\n   ${c.detail}` : ""}`), "", `Report: ${origin}/print/report`, `All checks: ${origin}/print/api/watch`].join("\n");
  return { subject, html, text };
}

export async function runWatch(env, { trigger = "manual", email = trigger === "cron", now = new Date() } = {}) {
  let result;
  try { result = assess(await gather(env, now)); }
  catch (e) { result = { status: "fail", checks: [{ id: "watch", status: "fail", title: "The night watch itself failed", detail: e.message }] }; }
  const prev = await env.DB.prepare("SELECT checks FROM watch_runs WHERE trigger = 'cron' ORDER BY id DESC LIMIT 1").first().catch(() => null);
  const items = toSend(result, prev ? JSON.parse(prev.checks) : []);
  let emailed = 0;
  if (email && items.length && env.MAILER) {
    const to = String(env.WATCH_ALERT_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (to.length) {
      const m = alertEmail(items, result);
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
  await env.DB.prepare("INSERT INTO watch_runs (ran_at, trigger, status, checks, emailed) VALUES (?,?,?,?,?)")
    .bind(now.toISOString(), trigger, result.status, JSON.stringify(result.checks), emailed).run().catch(() => {});
  return { ...result, ran_at: now.toISOString(), trigger, emailed, sent: items.map((c) => c.id) };
}
