// What stands out — the insight engine.
//
// Pure. Shared by the report page and the tests.
//
// A PERIOD is a day, an ISO week (Mon–Sun), a month or a year. For any slice of
// jobs (the fleet, one ship, one department, one document type) and any period,
// insights() returns cards. Each card stands alone: it carries its own facts,
// its own comparison and its own drill-down, and it is emitted only when the
// evidence for it exists. No card is ever padded with a guess — a period with no
// previous period gets no "vs last month" line, not a zero.
//
// Comparisons, in the reader's words:
//   "previous"  = the period immediately before (last month, last week …)
//   "typical"   = the median of up to 8 earlier periods that had printing
//   "on record" = the highest of every period of that grain on file for the slice

import { busyIntervals, printIntervals, spreadByHour, quantile, dur, STALL_JOB_S, paper } from "./metrics.js";

export const GRAINS = ["day", "week", "month", "year"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WD = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const NOUN = { day: "day", week: "week", month: "month", year: "year" };

const addDays = (iso, n) => new Date(Date.parse(iso + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const weekday = (iso) => (new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7;

// ---- periods ---------------------------------------------------------------
export function periodOf(day, grain) {
  if (grain === "day") return day;
  if (grain === "week") return addDays(day, -weekday(day));
  if (grain === "month") return day.slice(0, 7);
  return day.slice(0, 4);
}
export function periodRange(key, grain) {
  if (grain === "day") return [key, key];
  if (grain === "week") return [key, addDays(key, 6)];
  if (grain === "month") {
    const [y, m] = key.split("-").map(Number);
    return [`${key}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)];
  }
  return [`${key}-01-01`, `${key}-12-31`];
}
export function shiftPeriod(key, grain, n) {
  if (grain === "day") return addDays(key, n);
  if (grain === "week") return addDays(key, 7 * n);
  if (grain === "month") {
    const [y, m] = key.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  }
  return String(+key + n);
}
export function periodLabel(key, grain) {
  if (grain === "day") { const [y, m, d] = key.split("-"); return `${WD[weekday(key)]} ${+d} ${MON[+m - 1]} ${y}`; }
  if (grain === "week") { const e = addDays(key, 6); return `Week of ${+key.slice(8)} ${MON[+key.slice(5, 7) - 1]} – ${+e.slice(8)} ${MON[+e.slice(5, 7) - 1]} ${e.slice(0, 4)}`; }
  if (grain === "month") return `${MONTH[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
  return key;
}
const prevWord = { day: "the day before", week: "last week", month: "last month", year: "last year" };

// Part of the period falls outside the data on file → the reader is told, so a
// half-month is never read as a slow month.
export function coverage(key, grain, dayMin, dayMax) {
  const [a, b] = periodRange(key, grain);
  const from = a < dayMin ? dayMin : a, to = b > dayMax ? dayMax : b;
  const span = (x, y) => Math.round((Date.parse(y) - Date.parse(x)) / 86400000) + 1;
  return { from, to, days: Math.max(0, span(from, to)), of: span(a, b), partial: from > a || to < b };
}

// ---- measuring a slice -----------------------------------------------------
// busy/printing seconds per DAY for a slice, union per ship (never double-counted)
export function dailyBusy(jobs, bases) {
  const byShip = {};
  for (const j of jobs) (byShip[j.ship] ||= []).push(j);
  const days = {};
  for (const [ship, js] of Object.entries(byShip)) {
    spreadByHour(busyIntervals(js), (d, wd, h, s) => { const x = (days[d] ||= { busy: 0, print: 0, hours: new Array(24).fill(0) }); x.busy += s; x.hours[h] += s; });
    spreadByHour(printIntervals(js, bases[ship] || null), (d, wd, h, s) => { days[d].print += s; });
  }
  return days;
}

function sumPeriod(days, [a, b]) {
  let busy = 0, print = 0; const hours = new Array(24).fill(0); const perDay = [];
  for (const [d, v] of Object.entries(days)) {
    if (d < a || d > b) continue;
    busy += v.busy; print += v.print; v.hours.forEach((s, h) => (hours[h] += s)); perDay.push([d, v.busy]);
  }
  return { busy, print, stall: busy - print, hours, perDay };
}

const inRange = (j, [a, b]) => j.day >= a && j.day <= b;
const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const hrs = (s) => { const h = s / 3600; return h > 0 && h < 1 ? "<1 h" : `${Math.round(h).toLocaleString("en-US")} h`; };
const n0 = (n) => Math.round(n || 0).toLocaleString("en-US");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function change(cur, prev) {
  if (!prev) return null;
  const p = Math.round((100 * (cur - prev)) / prev);
  return p === 0 ? "the same as" : p > 0 ? `${p}% more than` : `${-p}% less than`;
}

// ---- the cards -------------------------------------------------------------
// jobs:  every job of the slice, all dates (history is needed for "typical" and
//        "on record"). Each job carries ship, day, dept, cat, key, runS, stallS,
//        feed, color, black, result, file, endTs, startMs, waste.
// bases: ship → yardstick (metrics.baseline), or null
// docName: key → display name
// days:  optional precomputed dailyBusy(jobs, bases)
export function insights({ jobs, key, grain, bases, docName = (k) => k, dayMin, dayMax, days }) {
  days ||= dailyBusy(jobs, bases);
  const range = periodRange(key, grain);
  const prevKey = shiftPeriod(key, grain, -1);
  const prevRange = periodRange(prevKey, grain);
  const cov = coverage(key, grain, dayMin, dayMax);
  const cur = jobs.filter((j) => inRange(j, range));
  const prev = jobs.filter((j) => inRange(j, prevRange));
  const havePrev = prevRange[1] >= dayMin && prev.length > 0;
  const T = sumPeriod(days, range), P = havePrev ? sumPeriod(days, prevRange) : null;
  const noun = NOUN[grain];
  const cards = [];
  const card = (c) => cards.push(c);
  if (!cur.length) return { cards, cov, empty: true };
  const ships = [...new Set(cur.map((j) => j.ship))];
  const noBase = ships.filter((s) => !bases[s]);
  const presses = ships.length > 1 ? ` across ${ships.length} presses` : "";

  // history of this grain → typical + record
  const periods = new Map();
  for (const d of Object.keys(days)) { const k = periodOf(d, grain); periods.set(k, (periods.get(k) || 0) + days[d].busy); }
  const earlier = [...periods.entries()].filter(([k, v]) => k < key && v > 0).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 8).map(([, v]) => v).sort((a, b) => a - b);
  const typical = earlier.length >= 3 ? quantile(earlier, 0.5) : null;
  const allFull = [...periods.entries()].filter(([k]) => !coverage(k, grain, dayMin, dayMax).partial);
  const best = allFull.sort((a, b) => b[1] - a[1])[0];

  // 1 · press time
  {
    const bits = [];
    const c = change(T.busy, P?.busy);
    if (c) bits.push(`${c} ${prevWord[grain]} (${hrs(P.busy)})`);
    if (typical) bits.push(`a typical ${noun} is ${hrs(typical)}`);
    const record = !cov.partial && best && best[0] === key && allFull.length >= 3;
    card({
      id: "busy", icon: "clock", tone: record ? "hot" : "info",
      title: record ? `Busiest ${noun} on record` : "Press time",
      html: `The press was busy <b>${hrs(T.busy)}</b>${presses}${bits.length ? ` — ${bits.join("; ")}` : ""}.${cov.partial ? ` <span class="part">Only ${cov.days} of ${cov.of} days are on file.</span>` : ""}`,
      go: { tab: "overview" },
    });
  }

  // 2 · stalled
  if (!noBase.length && T.busy > 0) {
    const worst = cur.filter((j) => (j.stallS || 0) >= STALL_JOB_S).sort((a, b) => b.stallS - a.stallS);
    const share = pct(T.stall, T.busy), pShare = P && P.busy ? pct(P.stall, P.busy) : null;
    const trend = pShare == null ? "" : share > pShare ? ` (up from ${pShare}% ${prevWord[grain]})` : share < pShare ? ` (down from ${pShare}% ${prevWord[grain]})` : ` (same as ${prevWord[grain]})`;
    card({
      id: "stall", icon: "alert", tone: share >= 30 ? "warn" : "info",
      title: "Stalled time",
      html: `<b>${share}%</b> of press time was stalled — ${hrs(T.stall)}${trend}.${worst[0] ? ` Worst: <b>${esc(docName(worst[0].key))}</b> on ${esc(worst[0].ship)}, ${dur(worst[0].stallS)} past normal.` : ""}`,
      go: { tab: "stalls" },
    });
  }

  // 3 · when — busiest day (week/month/year) or busiest hour (day)
  if (grain === "day") {
    const h = T.hours.indexOf(Math.max(...T.hours));
    const first = cur.filter((j) => j.startMs != null).map((j) => j.startMs).sort((a, b) => a - b)[0];
    const last = cur.map((j) => Date.parse(j.endTs.replace(" ", "T") + "Z")).sort((a, b) => b - a)[0];
    const hhmm = (ms) => new Date(ms).toISOString().slice(11, 16);
    card({
      id: "when", icon: "cal", tone: "info", title: "Shape of the day",
      html: `First job started <b>${first ? hhmm(first) : "—"}</b>, last ended <b>${hhmm(last)}</b>. Busiest hour: <b>${String(h).padStart(2, "0")}:00–${String((h + 1) % 24).padStart(2, "0")}:00</b> (${Math.round(T.hours[h] / 60)} min).`,
      go: { tab: "workload" },
    });
  } else if (T.perDay.length) {
    const [d, s] = T.perDay.sort((a, b) => b[1] - a[1])[0];
    const dj = cur.filter((j) => j.day === d);
    const top = groupTop(dj, (j) => j.cat, (j) => j.runS || 0);
    const idle = cov.days - T.perDay.length;
    card({
      id: "when", icon: "cal", tone: "info", title: `Busiest day of the ${noun}`,
      html: `<b>${periodLabel(d, "day")}</b>: ${hrs(s)} busy${presses}, ${n0(dj.length)} jobs${top ? `, mostly ${esc(top[0])}` : ""}.${idle > 0 && grain !== "year" ? ` ${idle} day${idle > 1 ? "s" : ""} with no jobs logged.` : ""}`,
      go: { day: d, tab: "jobs" },
    });
  }

  // 4 · who — departments; inside a one-department slice, the ships instead
  {
    const byDept = new Set(cur.map((j) => j.dept)).size > 1;
    const dim = byDept ? (j) => j.dept : (j) => j.ship;
    const many = byDept || ships.length > 1;
    const now = groupAll(cur, dim, (j) => j.runS || 0);
    const tot = [...now.values()].reduce((a, b) => a + b, 0);
    const top = [...now.entries()].sort((a, b) => b[1] - a[1])[0];
    let mover = null;
    if (havePrev && many) {
      const was = groupAll(prev, dim, (j) => j.runS || 0);
      for (const d of new Set([...now.keys(), ...was.keys()])) {
        const delta = (now.get(d) || 0) - (was.get(d) || 0);
        if (!mover || Math.abs(delta) > Math.abs(mover[1])) mover = [d, delta, was.get(d) || 0, now.get(d) || 0];
      }
      if (mover && Math.abs(mover[1]) < 3600) mover = null; // under an hour is noise, not news
    }
    if (top && many) card({
      id: "dept", icon: "people", tone: "info", title: byDept ? "Departments" : "Ships",
      html: `<b>${esc(top[0])}</b> used the most press time: ${hrs(top[1])}, ${pct(top[1], tot)}% of the ${noun}.${mover ? ` Biggest change: <b>${esc(mover[0])}</b> ${mover[1] > 0 ? "up" : "down"} ${hrs(Math.abs(mover[1]))} on ${prevWord[grain]} (${hrs(mover[2])} → ${hrs(mover[3])}).` : ""}`,
      go: byDept ? { depts: [top[0]], tab: "printed" } : { ships: [top[0]], tab: "overview" },
    });
  }

  // 5 · documents — most repeated, and what is new
  {
    const real = cur.filter((j) => j.cat !== "Test Pattern / Copy" && j.key !== "(no file name)");
    const top = groupTop(real, (j) => j.key, () => 1);
    const seenBefore = new Set(jobs.filter((j) => j.day < range[0]).map((j) => j.key));
    // Planner days, inserts, the Voyager and sales day-by-days carry a new port or
    // date every edition — "new" there is the calendar, not news.
    const DATED = new Set(["Daily Planner", "Planner Insert", "The Voyager", "Sales Booklets"]);
    const fresh = [...groupAll(real.filter((j) => !seenBefore.has(j.key) && !DATED.has(j.cat) && j.key.length >= 5), (j) => j.key, () => 1).entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
    const canSayNew = jobs.some((j) => j.day < range[0]);
    if (top) card({
      id: "docs", icon: "doc", tone: "info", title: "What was printed",
      html: `Most repeated: <b>${esc(docName(top[0]))}</b>, ${n0(top[1])} times.${canSayNew && fresh.length ? ` New this ${noun}: ${fresh.slice(0, 3).map(([k, n]) => `<b>${esc(docName(k))}</b> (${n}×)`).join(", ")}${fresh.length > 3 ? ` and ${fresh.length - 3} more` : ""}.` : ""}`,
      go: { doc: top[0], tab: "printed" },
    });
  }

  // 6 · the longest job, and the slowest against normal
  {
    const done = cur.filter((j) => j.runS != null && j.result === "Complete");
    const longest = done.sort((a, b) => b.runS - a.runS)[0];
    if (longest) card({
      id: "long", icon: "clock", tone: "info", title: "Longest job",
      html: `<b>${esc(docName(longest.key))}</b> on ${esc(longest.ship)} (${esc(longest.dept)}): ${dur(longest.runS)} for ${n0(longest.feed)} sheets${longest.expS ? `, normal is ${dur(longest.expS)}` : ""}.`,
      go: { day: longest.day, ships: [longest.ship], tab: "jobs" },
    });
  }

  // 7 · cancels & waste
  {
    const cx = cur.filter((j) => j.result === "Cancel");
    const pcx = havePrev ? prev.filter((j) => j.result === "Cancel").length : null;
    const waste = cur.reduce((a, j) => a + j.waste, 0);
    if (cx.length || waste) {
      const who = groupTop(cx, (j) => j.dept, () => 1);
      const c = pcx != null ? change(cx.length, pcx) : null;
      card({
        id: "cancel", icon: "drop", tone: pct(cx.length, cur.length) >= 10 ? "warn" : "info", title: "Cancels & waste",
        html: `<b>${n0(cx.length)}</b> jobs cancelled (${pct(cx.length, cur.length)}%)${c ? `, ${c} ${prevWord[grain]}` : ""}; ${n0(waste)} waste sheets.${who && who[1] > 1 && new Set(cx.map((j) => j.dept)).size > 1 ? ` Most from <b>${esc(who[0])}</b> (${who[1]}).` : ""}`,
        go: { result: "Cancel", tab: "jobs" },
      });
    }
  }

  // 7b · paper — boxes and pallets (size assumed from the tray; see metrics.PAPER)
  {
    const p = paper(cur), q = havePrev ? paper(prev) : null;
    if (p.boxes > 0) {
      const bx = (v) => (v > 0 && v < 1 ? "<1" : n0(v));
      const c = q && q.boxes ? change(p.boxes, q.boxes) : null;
      card({
        id: "paper", icon: "doc", tone: "info", title: "Paper used",
        html: `About <b>${bx(p.boxes)} boxes</b> (${p.pallets >= 1 ? `${Math.round(p.pallets)} pallet${p.pallets >= 1.5 ? "s" : ""}` : "under a pallet"}): ${bx(p.letterBoxes)} of 8.5×11, ${bx(p.tabloidBoxes)} of 11×17${c ? ` — ${c} ${prevWord[grain]}` : ""}. <span class="part">Size assumed from the tray.</span>`,
        go: { tab: "overview" },
      });
    }
  }

  // 8 · colour — only when it moved
  if (havePrev) {
    const share = (js) => { const c = js.reduce((a, j) => a + j.color, 0), b = js.reduce((a, j) => a + j.black, 0); return c + b ? (100 * c) / (c + b) : null; };
    const a = share(cur), b = share(prev);
    if (a != null && b != null && Math.abs(a - b) >= 3) card({
      id: "color", icon: "doc", tone: "info", title: "Colour mix",
      html: `Colour was <b>${Math.round(a)}%</b> of clicks, ${a > b ? "up" : "down"} from ${Math.round(b)}% ${prevWord[grain]}.`,
      go: { tab: "overview" },
    });
  }
  return { cards, cov, empty: false };
}

function groupAll(js, k, v) { const m = new Map(); for (const j of js) m.set(k(j), (m.get(k(j)) || 0) + v(j)); return m; }
function groupTop(js, k, v) { return [...groupAll(js, k, v).entries()].sort((a, b) => b[1] - a[1])[0] || null; }
