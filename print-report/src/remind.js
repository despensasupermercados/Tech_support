// Monthly upload reminder — the 1st of each month, to the person who uploads the
// press job histories (Ohji.Miranda@dg3.com, on file in cims-parts-portal).
//
// It is a reminder with evidence, not a nag: for last month it names each ship,
// the last job on file, and the days still missing. A ship already complete for
// the month says so. Nothing is claimed about ships never uploaded — the app only
// knows ships it has seen.
//
// The address is written as plain text: rewriting mail gateways (Mimecast) break
// hyperlinks — learned in cims-hon, 2026-09-14.

import { mast } from "./cims-mast.js";

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fday = (iso) => `${+iso.slice(8, 10)} ${MON[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}`;
const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

// now → the month the reminder is about (the one that just ended)
export function reportMonth(now) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  const end = d.toISOString().slice(0, 10);
  return { key: end.slice(0, 7), from: end.slice(0, 8) + "01", to: end, name: `${MONTH[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
}

// ships: [{ ship, last: 'YYYY-MM-DD…' }] → per-ship status for the month
export function monthStatus(ships, m) {
  return ships.map((s) => {
    const last = s.last.slice(0, 10);
    if (last >= m.to) return { ship: s.ship, last, done: true };
    const from = last >= m.from ? addDays(last, 1) : m.from;
    return { ship: s.ship, last, done: false, need: `${fday(from)} – ${fday(m.to)}` };
  });
}

export function reminderEmail(ships, now = new Date(), origin = "hon.cims.work") {
  const m = reportMonth(now);
  const rows = monthStatus(ships, m);
  const open = rows.filter((r) => !r.done);
  const subject = open.length
    ? `Print report · upload the ${m.name} press job history · ${open.length} of ${rows.length} ships missing days`
    : `Print report · ${m.name} is complete for all ${rows.length} ships`;
  const F = "Helvetica,Arial,sans-serif";
  const row = (r) => `<tr>
    <td style="padding:10px 12px;border-top:1px solid #E5E7EB;font-family:${F};font-size:14px;font-weight:600;color:#1B3A5C;">${esc(r.ship)}</td>
    <td style="padding:10px 12px;border-top:1px solid #E5E7EB;font-family:${F};font-size:13px;color:#374151;">${fday(r.last)}</td>
    <td style="padding:10px 12px;border-top:1px solid #E5E7EB;font-family:${F};font-size:13px;font-weight:600;color:${r.done ? "#3E7F2E" : "#B7791F"};">${r.done ? "Complete" : esc(r.need)}</td></tr>`;
  const step = (n, t) => `<tr><td width="34" valign="top" style="padding:6px 0;"><div style="width:26px;height:26px;border-radius:13px;background:#1B3A5C;color:#FFFFFF;font-family:${F};font-size:13px;font-weight:700;line-height:26px;text-align:center;">${n}</div></td>
    <td style="padding:8px 0 6px 6px;font-family:${F};font-size:14px;color:#374151;line-height:1.45;">${t}</td></tr>`;
  const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#F3F4F6" style="background:#F3F4F6;"><tr><td align="center" style="padding:16px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;max-width:600px;width:100%;">
  <tr><td style="padding:0;">${mast()}</td></tr>
  <tr><td style="padding:24px 24px 4px;font-family:${F};">
    <div style="font-size:11px;font-weight:700;letter-spacing:1.4px;color:#3E7F2E;">MONTHLY · PRINT REPORT</div>
    <div style="font-size:21px;font-weight:700;color:#1B3A5C;margin-top:4px;">${open.length ? `Upload the ${m.name} press job history` : `${m.name} is complete`}</div>
    <div style="font-size:14px;color:#374151;margin-top:8px;line-height:1.5;">${open.length ? `Hi Ohji — it is the 1st, so ${m.name} goes into the print report. ${open.length === rows.length ? "Every ship still has" : `${open.length} of ${rows.length} ships still ${open.length === 1 ? "has" : "have"}`} days missing.` : `Hi Ohji — every ship already has ${m.name} on file. Nothing to do this month.`}</div>
  </td></tr>
  <tr><td style="padding:14px 24px 4px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #E5E7EB;">
      <tr bgcolor="#F3F4F6" style="background:#F3F4F6;">
        <td style="padding:8px 12px;font-family:${F};font-size:10px;font-weight:700;letter-spacing:1.2px;color:#6B7280;">SHIP</td>
        <td style="padding:8px 12px;font-family:${F};font-size:10px;font-weight:700;letter-spacing:1.2px;color:#6B7280;">LAST JOB ON FILE</td>
        <td style="padding:8px 12px;font-family:${F};font-size:10px;font-weight:700;letter-spacing:1.2px;color:#6B7280;">STILL NEEDED</td></tr>
      ${rows.map(row).join("")}
    </table>
  </td></tr>
  ${open.length ? `<tr><td style="padding:18px 24px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${step(1, `Export the <b>job history</b> from the press on each ship above — <b>.xlsx or .csv</b>, one file per ship, <b>ship name in the file name</b>.`)}
    ${step(2, `Open the address below and <b>drop the files</b>.`)}
    ${step(3, `Done. Jobs already on file are skipped, so sending a longer range is safe.`)}
  </table></td></tr>
  <tr><td style="padding:14px 24px 4px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td bgcolor="#142D48" style="background:#142D48;padding:16px 18px;font-family:${F};">
      <div style="font-size:10px;font-weight:700;letter-spacing:1.4px;color:#95A0AD;">UPLOAD PAGE — TYPE OR COPY THIS ADDRESS</div>
      <div style="font-size:22px;font-weight:700;color:#FFFFFF;margin-top:6px;letter-spacing:.3px;">${origin}/print</div>
    </td></tr></table></td></tr>` : ""}
  <tr><td style="padding:18px 24px 24px;font-family:${F};font-size:12px;color:#6B7280;line-height:1.5;">
    Sent automatically on the 1st of each month by the print report.<br>The report: ${origin}/print/report
  </td></tr>
  </table></td></tr></table>`;
  const text = [
    open.length ? `Upload the ${m.name} press job history` : `${m.name} is complete`, "",
    ...rows.map((r) => `${r.ship.padEnd(10)} last job ${fday(r.last).padEnd(12)} ${r.done ? "complete" : `needed: ${r.need}`}`), "",
    ...(open.length ? ["1. Export the job history from the press on each ship above (.xlsx or .csv, ship name in the file name).", `2. Open ${origin}/print and drop the files.`, "3. Done. Jobs already on file are skipped.", ""] : []),
    `The report: ${origin}/print/report`,
  ].join("\n");
  return { subject, html, text, month: m, open: open.length };
}

export async function sendReminder(env, now = new Date()) {
  if (env.REMIND_ENABLED !== "1") return { skipped: "REMIND_ENABLED is not 1" };
  const to = String(env.REMIND_TO || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!to.length || !env.MAILER) return { skipped: "no recipient or mailer" };
  const ships = (await env.DB.prepare("SELECT ship, MAX(end_ts) AS last FROM jobs WHERE length(end_ts) = 19 GROUP BY ship ORDER BY ship").all()).results;
  if (!ships.length) return { skipped: "nothing on file" };
  const m = reminderEmail(ships, now);
  const res = await env.MAILER.fetch("https://mailer/send", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ app: "cims-print", templateId: "print.remind.v1", idempotencyKey: `print-remind-${m.month.key}`,
      from: "CIMS <cims@cims.work>", to, subject: m.subject, html: m.html, text: m.text, critical: true }),
  });
  return { ok: res.ok, status: res.status, month: m.month.key, open: m.open };
}
