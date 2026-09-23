// Press job-log parser — Konica Minolta AccurioPress job history export.
//
// Pure. Runs in the browser (drop page) and under node (tests). Input is a 2-D
// array of cells exactly as SheetJS returns it with { header: 1, raw: true }, so
// the same code reads the .xlsx workbook and a .csv export.
//
// THE EXPORT'S SHAPE (learned from the Azamara Jan–Sep 2026 workbook):
//   header block, 3 rows:  No. | Date | Job End     | Job ID | Mode | Username | Result | Output Tray | Page/Set  | ... counters
//                                     | Print Start |        |      | Filename |        |             | Sheet/Set |
//                                     | Job Accept  |
//   each job, 3 rows + a blank spacer:
//     row 1: No., Date, end time, Job ID, Mode, Username, Result, Tray, "1100 page", counters…
//     row 2:           start time,                Filename,               "550 sheet"
//     row 3:           accept time
//
// Facts the parser relies on, each checked against the real file:
//   - `Date` is the date the job ENDED. Job 49230 (Pursuit) was accepted 23:56 on
//     18 Sep, ended 00:04, and is dated 19 Sep. So timestamps are rebuilt
//     backwards from the end: start = end − run, accept = start − wait.
//   - A start of 00:00:00 on a job that fed no paper means the press never ran it
//     (537 cancels + 115 authentication errors in the sample). Those jobs carry
//     no run time — a null, never a zero-length run.
//   - Job IDs repeat across ships, so a job is keyed on ship + Job ID + end.

const HEADER_KEYS = {
  "no.": "no", "date": "date", "job end": "end", "job id": "jobId", "mode": "mode",
  "username": "user", "result": "result", "output tray": "tray", "page/set": "pageSet",
  "set number": "sets", "output set": "outSets", "full color": "color", "black": "black",
  "mono color": "mono", "feed count": "feed", "exit count": "exit",
  "waste sheets": "waste", "remove sheets": "remove",
};
const REQUIRED = ["no", "date", "end", "jobId", "user", "result", "feed"];

const norm = (v) => String(v == null ? "" : v).trim();

// Seconds since midnight from an Excel time fraction, a Date, or "9:16:28".
export function toSeconds(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const frac = v - Math.floor(v);
    return Math.round(frac * 86400) % 86400;
  }
  if (v instanceof Date) return v.getHours() * 3600 + v.getMinutes() * 60 + v.getSeconds();
  const m = String(v).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return null;
  let h = +m[1];
  if (m[4]) { const pm = m[4].toUpperCase() === "PM"; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  return h * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0);
}

// ISO day "YYYY-MM-DD" from an Excel serial, a Date, or a text date.
export function toDay(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const ms = Math.round((Math.floor(v) - 25569) * 86400000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // Day-first vs month-first cannot be told apart for 1–12, so an ambiguous
  // text date is refused rather than guessed. The press exports ISO or serials.
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a > 12 && b <= 12) return `${m[3]}-${String(b).padStart(2, "0")}-${String(a).padStart(2, "0")}`;
    if (b > 12 && a <= 12) return `${m[3]}-${String(a).padStart(2, "0")}-${String(b).padStart(2, "0")}`;
  }
  return null;
}

const int = (v) => {
  if (v == null || v === "" || v === "-") return 0;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
};
const lead = (v) => { const m = norm(v).match(/^(\d[\d,]*)/); return m ? int(m[1]) : null; };

// "2026-09-21" + seconds → "2026-09-21 09:16:28"; offsets in whole days allowed.
export function stamp(day, secs) {
  const d = new Date(`${day}T00:00:00Z`);
  const t = new Date(d.getTime() + secs * 1000);
  return t.toISOString().slice(0, 19).replace("T", " ");
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = (rows[i] || []).map((c) => norm(c).toLowerCase());
    if (cells.includes("job id") && cells.includes("job end")) {
      const map = {};
      cells.forEach((c, j) => { if (HEADER_KEYS[c]) map[HEADER_KEYS[c]] = j; });
      // the Filename and Sheet/Set labels live on the header's second row
      const r2 = (rows[i + 1] || []).map((c) => norm(c).toLowerCase());
      map.file = r2.indexOf("filename") >= 0 ? r2.indexOf("filename") : map.user;
      map.sheetSet = r2.indexOf("sheet/set") >= 0 ? r2.indexOf("sheet/set") : map.pageSet;
      map.start = r2.indexOf("print start") >= 0 ? r2.indexOf("print start") : map.end;
      const r3 = (rows[i + 2] || []).map((c) => norm(c).toLowerCase());
      map.accept = r3.indexOf("job accept") >= 0 ? r3.indexOf("job accept") : map.end;
      const missing = REQUIRED.filter((k) => map[k] == null);
      return { at: i, map, missing, headerRows: r3.includes("job accept") ? 3 : r2.includes("print start") ? 2 : 1 };
    }
  }
  return null;
}

const isJobRow = (r, map) => {
  const no = r && r[map.no];
  return no != null && no !== "" && /^\d+$/.test(norm(no));
};

// Parse one sheet. Returns { jobs, problems, recognised }.
//   recognised=false → not a press job log at all; the caller refuses the file.
export function parseSheet(rows) {
  const h = findHeader(rows || []);
  if (!h) return { recognised: false, jobs: [], problems: ["No press job-log header found (needs 'Job ID' and 'Job End' columns)."] };
  if (h.missing.length) return { recognised: false, jobs: [], problems: [`Header is missing: ${h.missing.join(", ")}.`] };
  const { map } = h;
  const jobs = [];
  const problems = [];
  let i = h.at + h.headerRows;
  while (i < rows.length) {
    const r = rows[i];
    if (!isJobRow(r, map)) { i++; continue; }
    // continuation rows: everything up to the next numbered row
    const cont = [];
    let k = i + 1;
    while (k < rows.length && !isJobRow(rows[k], map) && cont.length < 3) {
      const row = rows[k] || [];
      if (row.some((c) => norm(c) !== "")) cont.push(row);
      k++;
    }
    const r2 = cont[0] || [];
    const r3 = cont[1] || [];
    const day = toDay(r[map.date]);
    const endS = toSeconds(r[map.end]);
    const startS = toSeconds(r2[map.start]);
    const acceptS = toSeconds(r3[map.accept]);
    const no = int(r[map.no]);
    if (!day || endS == null) {
      problems.push(`Log no. ${no}: unreadable date or end time — skipped.`);
      i = k; continue;
    }
    const feed = int(r[map.feed]);
    const result = norm(r[map.result]);
    const neverRan = startS === 0 && feed === 0;
    const run = startS == null || neverRan ? null : (endS - startS + 86400) % 86400;
    const endTs = stamp(day, endS);
    const startTs = run == null ? null : stamp(day, endS - run);
    const startRef = run == null ? endS : endS - run;
    const wait = acceptS == null ? null : ((startRef - acceptS) % 86400 + 86400) % 86400;
    const acceptTs = wait == null ? null : stamp(day, startRef - wait);
    jobs.push({
      no,
      jobId: int(r[map.jobId]),
      endTs, startTs, acceptTs,
      runS: run,
      waitS: wait,
      mode: norm(r[map.mode]),
      user: norm(r[map.user]),
      result,
      tray: norm(r[map.tray]),
      pages: lead(r[map.pageSet]),
      sheets: lead(r2[map.sheetSet]),
      sets: int(r[map.sets]),
      outSets: int(r[map.outSets]),
      color: int(r[map.color]),
      black: int(r[map.black]),
      mono: int(r[map.mono]),
      feed,
      exit: int(r[map.exit]),
      waste: int(r[map.waste]),
      file: norm(r2[map.file]) || null,
    });
    i = k;
  }
  return { recognised: true, jobs, problems };
}

// ---- ship detection -------------------------------------------------------
// Canonical short names, as HON keys them (src/lib/shipNames.js in cims-hon).
export const FLEET = [
  "Adventure", "Allure", "Anthem", "Apex", "Ascent", "Beyond", "Brilliance",
  "Constellation", "Eclipse", "Edge", "Enchantment", "Equinox", "Explorer",
  "Freedom", "Grandeur", "Harmony", "Icon", "Independence", "Infinity", "Jewel",
  "Journey", "Legend", "Liberty", "Mariner", "Millennium", "Navigator", "Oasis",
  "Odyssey", "Onward", "Ovation", "Pursuit", "Quantum", "Quest", "Radiance",
  "Reflection", "Rhapsody", "Serenade", "Silhouette", "Solstice", "Spectrum",
  "Star", "Summit", "Symphony", "Utopia", "Vision", "Voyager", "Wonder", "Xcel",
];

// Returns the one ship named in the text, or null. Two different ships named →
// null: the uploader picks. A ship is never guessed.
export function shipIn(text) {
  const t = ` ${String(text || "").replace(/[_\-.()[\]]+/g, " ")} `.toUpperCase();
  const hits = FLEET.filter((s) => new RegExp(`[^A-Z]${s.toUpperCase()}[^A-Z]`).test(t));
  return hits.length === 1 ? hits[0] : null;
}

// Whole workbook → one entry per sheet that holds a job log.
//   sheets: [{ name, rows }]   fileName: the dropped file's name
export function parseWorkbook(sheets, fileName) {
  const out = [];
  const fromFile = shipIn(fileName);
  for (const s of sheets) {
    const p = parseSheet(s.rows);
    if (!p.recognised) continue;
    const ship = shipIn(s.name) || (sheets.length === 1 ? fromFile : null);
    const days = p.jobs.map((j) => j.endTs.slice(0, 10)).sort();
    out.push({
      sheet: s.name,
      ship,
      shipSource: shipIn(s.name) ? "tab" : ship ? "filename" : null,
      jobs: p.jobs,
      problems: p.problems,
      from: days[0] || null,
      to: days[days.length - 1] || null,
    });
  }
  return out;
}
