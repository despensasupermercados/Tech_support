// Daylight — the CIMS report-email body (cims-email-standard §9, ratified 24 Sep 2026,
// Brain recuwEz3HB4HHKZ4R). Headline first, stat strip, one card per exception.
// Local copy per EMAIL-CONVENTION §5 — do not import across apps.
// Outlook rules: tables + inline styles, bgcolor paired with background, no rgba, no gradients.
import { mastRows } from "./cims-mast.js";

export const T = {
  navy: "#1B3A5C", green: "#5FB946", greenInk: "#3E7F2E", slate: "#6B7280", cloud: "#F3F4F6",
  border: "#E5E7EB", body: "#374151", red: "#96281B", amber: "#B7791F", grey: "#9CA3AF",
  redTint: "#F4E5E3", amberTint: "#F6EEE1",
};
const FH = "'Outfit',Helvetica,Arial,sans-serif";
const FB = "'DM Sans',Helvetica,Arial,sans-serif";
export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const shortDate = (d) => `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]}`;

const TONE = {
  red: { rule: T.red, pillBg: T.redTint, pillFg: T.red },
  amber: { rule: T.amber, pillBg: T.amberTint, pillFg: T.amber },
  green: { rule: T.green, pillBg: T.cloud, pillFg: T.greenInk },
};

// eyebrow: caps report name. headline: [dark, grey]. lead: one plain sentence (trusted HTML).
// stats: up to 3 × { n, label, tone }. body: HTML rows (cards). footer: trusted HTML lines.
export function page({ preheader, eyebrow, date, headline, lead, stats = [], body = "", footer = [] }) {
  const stat = stats.map((s, i) => `${i ? `<td width="12" style="font-size:0;">&nbsp;</td>` : ""}<td width="33%" valign="top" align="center" style="text-align:center;padding:14px 0 0;border-top:3px solid ${TONE[s.tone].rule};">
        <div style="font-family:${FH};font-size:30px;font-weight:700;color:${T.navy};line-height:1;">${esc(s.n)}</div>
        <div style="font-family:${FB};font-size:12px;color:${T.slate};margin-top:6px;">${esc(s.label)}</div></td>`).join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting">
<style>@media only screen and (max-width:480px){.dl-frame{padding:0 !important}.dl-gut{padding-left:20px !important;padding-right:20px !important}.dl-h1{font-size:30px !important}}</style></head>
<body style="margin:0;padding:0;background:${T.cloud};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;color:${T.cloud};">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.cloud}" style="background:${T.cloud};"><tr><td align="center" class="dl-frame" style="padding:24px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="background:#FFFFFF;max-width:600px;width:100%;font-family:${FB};">
${mastRows()}
<tr><td class="dl-gut" style="padding:22px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
  <td style="font-family:${FB};font-size:12px;font-weight:700;letter-spacing:1.4px;color:${T.greenInk};">${esc(eyebrow)}</td>
  <td align="right" style="font-family:${FB};font-size:13px;color:${T.slate};white-space:nowrap;">${esc(date)}</td></tr></table></td></tr>
<tr><td class="dl-gut" style="padding:16px 28px 0;">
  <div class="dl-h1" style="font-family:${FH};font-size:36px;font-weight:600;line-height:1.1;letter-spacing:-.6px;color:${T.navy};">${esc(headline[0])}${headline[1] ? `<br><span style="color:${T.grey};">${esc(headline[1])}</span>` : ""}</div>
  ${lead ? `<div style="font-family:${FB};font-size:15px;line-height:1.5;color:${T.body};margin-top:14px;">${lead}</div>` : ""}
</td></tr>
${stats.length ? `<tr><td class="dl-gut" style="padding:22px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${stat}</tr></table></td></tr>` : ""}
${body}
<tr><td class="dl-gut" style="padding:28px 28px 26px;font-family:${FB};font-size:12px;line-height:1.6;color:${T.slate};">${footer.join("<br>")}</td></tr>
</table></td></tr></table></body></html>`;
}

// One exception card. title/meta/note are plain text (escaped here).
export function card({ title, pill, tone = "red", meta, note, first = false }) {
  const t = TONE[tone];
  return `<tr><td class="dl-gut" style="padding:${first ? 28 : 12}px 28px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${T.cloud}" style="background:${T.cloud};border-radius:16px;"><tr><td style="padding:20px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="top" style="font-family:${FH};font-size:20px;font-weight:600;line-height:1.25;color:${T.navy};padding-right:10px;">${esc(title)}</td>
      ${pill ? `<td valign="top" align="right" style="white-space:nowrap;"><span style="display:inline-block;background:${t.pillBg};color:${t.pillFg};font-family:${FB};font-size:12px;font-weight:700;padding:6px 11px;border-radius:999px;white-space:nowrap;">${esc(pill)}</span></td>` : ""}
    </tr></table>
    ${meta ? `<div style="font-family:${FB};font-size:13px;color:${T.slate};margin-top:8px;">${esc(meta)}</div>` : ""}
    ${note ? `<div style="margin-top:14px;padding-left:12px;border-left:3px solid ${t.rule};font-family:${FB};font-size:14px;line-height:1.5;color:${T.body};">${esc(note)}</div>` : ""}
  </td></tr></table></td></tr>`;
}
