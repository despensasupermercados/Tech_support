// Time on the press — the numbers behind "how many hours are we printing".
//
// Pure. Shared by the report page and the tests.
//
// WHAT THE LOG CAN AND CANNOT SAY
// The press records when a job started and ended. It does not record who stood
// at it. So every hour here is MACHINE time, and the page says so. It is never
// called labour.
//
// PRINTING vs STALLED
// Machine time includes jobs that sat paused: paper out, a jam, a job left on
// the press overnight. 600 sheets that took 10.5 hours were not printing for
// 10.5 hours. Each ship gets its own yardstick, measured from its own history:
//
//   normal(sheets) = setup + secPerSheet × sheets
//     setup        = median run of completed 1–2 sheet print jobs
//     secPerSheet  = median of (run − setup) / sheets over completed jobs ≥ 50 sheets
//
// A job is "printing" up to TOLERANCE × normal, so ordinary variation (duplex,
// heavy stock, a slow RIP) is never called a stall. Anything beyond is
// "stalled". The yardstick is computed on everything on file for that ship,
// never on the filtered view, so a filter cannot move the ruler.
//
// Too little history (< MIN_SAMPLE of either kind) → no yardstick → the split is
// not drawn for that ship. It is never borrowed from another ship.
//
// BUSY TIME
// Jobs can overlap in the log (one accepted while another prints). Busy time is
// the UNION of the run intervals per ship, so an hour is never counted twice.

export const TOLERANCE = 1.5;
export const MIN_SAMPLE = 20;
// A job counts as a "stalled job" only when it ran at least this far past its
// allowance: a 1-sheet job 40 s slow is noise, not a stall. Hours still count all.
export const STALL_JOB_S = 300;

// Azamara 2026 billed production rates, tariff-inclusive. Source: the Brain,
// record recSoDoerT7Orsnls (confirmed by Miguel 6 Aug 2026 from the Azamara
// billing workbook, July tab). Billed value — what Azamara is invoiced — not
// DG3's cost.
export const CPC = { color: 0.02903, black: 0.00705, source: "recSoDoerT7Orsnls", label: "2026 Azamara rate card (production, tariff-inclusive)" };

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const quantile = (sorted, q) => {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

const isPrint = (j) => j.result === "Complete" && j.mode === "Print" && j.runS != null && j.runS > 0;

// jobs of ONE ship → { setupS, secPerSheet, nSmall, nBig } or null
export function baseline(jobs) {
  const small = jobs.filter((j) => isPrint(j) && j.feed >= 1 && j.feed <= 2).map((j) => j.runS);
  const setup = median(small);
  if (small.length < MIN_SAMPLE || setup == null) return null;
  const big = jobs.filter((j) => isPrint(j) && j.feed >= 50).map((j) => Math.max(0, j.runS - setup) / j.feed);
  if (big.length < MIN_SAMPLE) return null;
  return { setupS: setup, secPerSheet: median(big), nSmall: small.length, nBig: big.length };
}

export function expectedS(base, feed) {
  if (!base) return null;
  return base.setupS + base.secPerSheet * Math.max(0, feed || 0);
}

// → { printS, stallS } ; stallS null when the ship has no yardstick
export function split(job, base) {
  if (job.runS == null) return { printS: 0, stallS: 0 };
  if (!base) return { printS: job.runS, stallS: null };
  const allowed = TOLERANCE * expectedS(base, job.feed);
  const printS = Math.min(job.runS, allowed);
  return { printS, stallS: job.runS - printS };
}

// "YYYY-MM-DD HH:MM:SS" → ms, treated as a wall-clock (UTC-parsed, never shifted)
export const ms = (ts) => Date.parse(ts.replace(" ", "T") + "Z");
// the report stores j.endMs once per job; parsing the string again each call cost ~0.1 s a load
const endOf = (j) => (j.endMs != null ? j.endMs : ms(j.endTs));
export const startMs = (j) => endOf(j) - j.runS * 1000;

function union(iv) {
  iv.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [a, b] of iv) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

// Union of run intervals for one ship's jobs → [[fromMs, toMs], …] sorted.
export function busyIntervals(jobs) {
  return union(jobs.filter((j) => j.runS != null && j.runS > 0).map((j) => [startMs(j), endOf(j)]));
}

// Union of the PRINTING part of each job: [start, start + min(run, allowance)].
// Busy − printing = stalled, so the two always add up to busy time exactly.
// No yardstick → the whole run counts as printing and the caller says "unknown".
export function printIntervals(jobs, base) {
  return union(jobs.filter((j) => j.runS != null && j.runS > 0).map((j) => {
    const s = startMs(j);
    return [s, s + split(j, base).printS * 1000];
  }));
}

export const HOUR = 3600000;
// Spread intervals over clock hours. cb(dayISO, weekday 0=Mon, hour, seconds).
export function spreadByHour(intervals, cb) {
  for (const [a, b] of intervals) {
    let t = a;
    while (t < b) {
      const next = Math.min(b, Math.floor(t / HOUR) * HOUR + HOUR);
      const d = new Date(t);
      cb(d.toISOString().slice(0, 10), (d.getUTCDay() + 6) % 7, d.getUTCHours(), (next - t) / 1000);
      t = next;
    }
  }
}

export const billed = (j) => j.color * CPC.color + j.black * CPC.black;

// Human durations, whole units only: "45 s", "38 min", "2 h 05 min".
export function dur(s) {
  if (s == null || !Number.isFinite(s)) return "—";
  s = Math.round(s);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

// ---- the press's working day ----------------------------------------------
// One ship's jobs → per calendar day (whatever clock endTs is on — the report feeds ship time):
//   first  — seconds after midnight the first job started (clipped to the day)
//   last   — seconds after midnight the last job ended   (clipped to the day)
//   window — last − first: the span the press was in use that day
//   busy   — seconds a job was on the press (overlaps counted once)
//   print  — seconds printing at normal speed; busy − print = stalled
//   idle   — window − busy: gaps between jobs inside the working window
//   iv     — the busy intervals, [fromS, toS] within the day, for the timeline
// A job across midnight counts on both days, each for its own part.
export function dayProfiles(jobs, base) {
  const out = {};
  const clip = (intervals, cb) => {
    for (const [a, b] of intervals) {
      let t = a;
      while (t < b) {
        const d0 = Math.floor(t / 86400000) * 86400000;
        const next = Math.min(b, d0 + 86400000);
        cb(new Date(d0).toISOString().slice(0, 10), (t - d0) / 1000, (next - d0) / 1000);
        t = next;
      }
    }
  };
  clip(busyIntervals(jobs), (day, a, b) => {
    const d = (out[day] ||= { first: a, last: b, busy: 0, print: 0, iv: [] });
    d.first = Math.min(d.first, a); d.last = Math.max(d.last, b); d.busy += b - a; d.iv.push([a, b]);
  });
  clip(printIntervals(jobs, base), (day, a, b) => { if (out[day]) out[day].print += b - a; });
  for (const d of Object.values(out)) { d.window = d.last - d.first; d.idle = d.window - d.busy; d.stall = d.busy - d.print; }
  return out;
}

// ---- paper ----------------------------------------------------------------
// Boxes and pallets from sheets fed. Counts EVERY sheet fed, including on jobs
// later cancelled — that paper was used.
//
// THE PRESS LOG HAS NO PAPER SIZE. The size is taken from the output tray:
// "FS Fold" is the booklet finisher (Shorex, sales and Voyager booklets), run
// on 11×17 and folded; every other tray is 8.5×11. That rule is an assumption
// Miguel set out to confirm (2026-09-23) — every screen that shows boxes says
// so. Change TABLOID_TRAYS here and nowhere else.
export const PAPER = { letterPerBox: 5000, tabloidPerBox: 2500, boxesPerPallet: 40, TABLOID_TRAYS: ["FS Fold"] };
export function paper(jobs) {
  let letter = 0, tabloid = 0;
  for (const j of jobs) { if (PAPER.TABLOID_TRAYS.includes(j.tray)) tabloid += j.feed || 0; else letter += j.feed || 0; }
  const letterBoxes = letter / PAPER.letterPerBox, tabloidBoxes = tabloid / PAPER.tabloidPerBox;
  const boxes = letterBoxes + tabloidBoxes;
  return { letter, tabloid, letterBoxes, tabloidBoxes, boxes, pallets: boxes / PAPER.boxesPerPallet };
}
