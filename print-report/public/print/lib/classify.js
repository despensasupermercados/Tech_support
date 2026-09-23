// What was printed — filename → document family, and the "same document" key.
//
// Pure. One definition, shared by the report page and the tests.
//
// Two outputs per job:
//   docKey(file)      — the filename with dates, days, numbers and extensions
//                       stripped, so "DAY 10 I AT SEA I SEPTEMBER 22, 2026.pdf"
//                       and "DAY 11 I AT SEA I SEPTEMBER 23, 2026.pdf" are one
//                       document. "Top repeating documents" groups on this.
//   category(job)     — one of CATEGORIES. A rule must MATCH to name a family;
//                       anything unmatched is "Other". Nothing is guessed from
//                       the department alone except where the department's
//                       output is one product (Voyager → The Voyager).
//
// "PowerPoint Presentation.pdf" is the generic name Office writes on export. Nine
// departments use it and it says nothing about content, so it stays Other.

export const CATEGORIES = [
  "Daily Planner", "Planner Insert", "Crew Insider", "Menus", "Tent Cards",
  "Shorex Booklets", "Sales Booklets", "The Voyager", "Invitations", "Itinerary Cards",
  "Flyers & Posters", "Games & Activities", "Wine & Beverage Lists",
  "Certificates", "Stateroom & Guest Cards", "Guest Letters & Info", "Checklists & Forms",
  "Test Pattern / Copy", "Other",
];

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";
const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun";

export function docKey(file) {
  if (!file) return "(no file name)";
  let f = String(file).toLowerCase();
  f = f.replace(/^microsoft (word|excel|powerpoint|publisher) - /, "");
  f = f.replace(/\.(pdf|docx?|xlsx?|pptx?|pub|jpe?g|png|txt)\b/g, " ");
  f = f.replace(/\(read-only\)|\(\d+\)|\bcopy of\b|\bfinal\b|\bto print\b|\bprint\b|\bupdated?\b|\bnew\b/g, " ");
  f = f.replace(new RegExp(`\\b(${MONTHS})\\b`, "g"), " ");
  f = f.replace(new RegExp(`\\b(${DAYS})\\b`, "g"), " ");
  f = f.replace(/\d+/g, " ");
  f = f.replace(/[_|,.\-–—#&+()[\]'"]+/g, " ");
  f = f.replace(/\b(i|l|v|ver|rev|st|nd|rd|th)\b/g, " ");
  f = f.replace(/\s+/g, " ").trim();
  return f || "(numbers only)";
}

// Planner days are named "<day> _ <port or AT SEA> _ <date>" or
// "DAY 10 I AT SEA I SEPTEMBER 22, 2026" — a day number or date plus a separator.
// "APRIL15" happens (no space), so the month may run straight into the day.
const DATED = new RegExp(`(\\b(${MONTHS})\\s*\\d{1,2})|(\\d{1,2}\\s*(${MONTHS})\\b)`, "i");
const PLANNER_SHAPE = /(^|\s)(day\s*\d+|\d{1,2})\s*[_|i]\s+.+\s[_|i]\s/i;

// Order matters. The first block is unambiguous words; then the planner-day
// shape is tested (see category); then the looser families.
const FIRST = [
  ["Crew Insider", /crew\s*insider/],
  ["Planner Insert", /\binsert\b/],
  ["Guest Letters & Info", /\bletters?\b/],
  ["Shorex Booklets", /booklet\s*(jr|pr|qs|on|voy)|small booklet|combo booklet|shorex|tour (desc|booklet)|excursion/],
  ["Sales Booklets", /day.?by.?day|all rooms|future cruise|brand offer|cn merged|copies booklet/],
  ["The Voyager", /\bthe voyager\b|^voyage\s*\d+|voyager - \d+/],
];
const RULES = [
  ["Itinerary Cards", /itinerary/],
  ["Tent Cards", /tent\s*card/],
  ["Invitations", /invit|special invitation|\binvite|circle & top|reception|\brsvp\b|private arrangement/],
  ["Menus", /menu|chef'?s ?table|hosting table|acamar|discoveries|top ?cruiser|room service|breakfast card|patio ticket|order ticket|omelet/],
  ["Wine & Beverage Lists", /wine|beverage|cocktail|drinks?\b|bar list|happy hour|by the glass/],
  ["Certificates", /certif|\bcert\b|this is to certify|diploma|award/],
  ["Games & Activities", /crossword|sudoku|bingo|binglo|trivia|photo hunt|quiz|puzzle|word search|scavenger/],
  ["Stateroom & Guest Cards", /stateroom|attend[ae]nt card|luggage|room qr|door hanger|cabin drop|guest name|name card|place card|welcome card|laundry|wash ?fold|key card/],
  ["Guest Letters & Info", /letter|directory|\bmap\b|port info|cover page|\bhours\b|email confirm|missing email|notice|announcement|disembark|information|\binfo\b|welcome|qr code|in transit|captain/],
  ["Checklists & Forms", /checklist|report|inspection|check list|\bform\b|log sheet|control sheet|sign.?in|inventory|schedule|roster|timesheet|policy|policies|search plan|drill|muster/],
  ["Flyers & Posters", /flyer|flier|poster|brochure|leaflet|\bsign\b|signage|offer|savings|promo|last.?minute|special/],
];

export function category(job) {
  const mode = String(job.mode || "").toLowerCase();
  if (mode === "test pattern" || mode === "copy" || mode === "list print") return "Test Pattern / Copy";
  const raw = String(job.file || "");
  // "_" is a word character to a regex, so "TopCruiser_Menu" would hide "menu".
  const f = raw.toLowerCase().replace(/^microsoft (word|excel|powerpoint|publisher) - /, "").replace(/[_]+/g, " ");
  if (!f) return "Other";
  for (const [cat, re] of FIRST) if (re.test(f)) return cat;
  const user = String(job.user || "").toLowerCase();
  if (/\bat sea\b|\bembarkation\b.*\d{4}|^\d{1,2}\s*embarkation/.test(f) || (PLANNER_SHAPE.test(f) && DATED.test(f))) return "Daily Planner";
  if (user === "insider" && DATED.test(f)) return "Daily Planner";
  for (const [cat, re] of RULES) if (re.test(f)) return cat;
  if (user === "voyager") return "The Voyager";
  return "Other";
}

// Account names on the press, case-folded to one spelling ("INSIDER" = "Insider").
// Shown exactly as the press shows them — never expanded into a guessed title.
const DEPT = { INSIDER: "Insider", HOTEL: "Hotel", BOM: "BOM", MENUS: "Menus", CRSALES: "CrSales",
  SHOREX: "Shorex", HK: "HK", REST: "Rest", VOYAGER: "Voyager", CD: "CD", BAR: "Bar",
  MARINE: "Marine", HR: "HR", PUBLIC: "Public" };
export function dept(user) {
  const u = String(user || "").trim();
  if (!u) return "(none)";
  return DEPT[u.toUpperCase()] || u.charAt(0).toUpperCase() + u.slice(1);
}
