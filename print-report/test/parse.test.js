import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSheet, parseWorkbook, shipIn, toDay, toSeconds } from "../public/print/lib/parse.js";

const H = [
  ["No.", "Date", "Job End", "Job ID", "Mode", "Username", "Result", "Output Tray", "Page/Set", "Set Number", "Output Set", "Full Color", "Black", "Mono Color", "Feed Count", "Exit Count", "Waste Sheets", "Remove Sheets"],
  [null, null, "Print Start", null, null, "Filename", null, null, "Sheet/Set"],
  [null, null, "Job Accept"],
];
const job = (no, date, end, id, user, result, feed, start, file, accept) => [
  [no, date, end, id, "Print", user, result, "FS/OT Main", `${feed * 2} page`, 1, 1, feed * 2, 0, 0, feed, feed, 0, "-"],
  [null, null, start, null, null, file, null, null, `${feed} sheet`],
  [null, null, accept],
  [],
];

test("rebuilds timestamps backwards from the END date (job 49230 shape)", () => {
  // accepted 23:56 on the 18th, ended 00:04 on the 19th, dated the 19th
  const rows = [...H, ...job(49230, "2026-09-19", "00:04:32", 51210, "CD", "Complete", 180, "23:56:07", "Bingo.pdf", "23:56:06")];
  const { jobs } = parseSheet(rows);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].startTs, "2026-09-18 23:56:07");
  assert.equal(jobs[0].acceptTs, "2026-09-18 23:56:06");
  assert.equal(jobs[0].endTs, "2026-09-19 00:04:32");
  assert.equal(jobs[0].runS, 505);
});

test("a 00:00:00 start with no paper fed is a job that never ran — null, not zero", () => {
  const rows = [...H, ...job(7, "2026-08-19", "10:00:00", 9, "Hotel", "Cancel", 0, "00:00:00", "x.pdf", "09:59:00")];
  const [j] = parseSheet(rows).jobs;
  assert.equal(j.runS, null);
  assert.equal(j.startTs, null);
});

test("reads Excel serials the same as text", () => {
  assert.equal(toDay(46286), "2026-09-21");
  assert.equal(toSeconds(0.5), 43200);
  assert.equal(toSeconds("9:16:28"), 33388);
  assert.equal(toSeconds("1:05:00 PM"), 47100);
  assert.equal(toSeconds("12:30:00 AM"), 1800);
});

test("an ambiguous day/month text date is refused, never guessed", () => {
  assert.equal(toDay("03/04/2026"), null);
  assert.equal(toDay("21/09/2026"), "2026-09-21");
});

test("a sheet with no job-log header is not recognised", () => {
  assert.equal(parseSheet([["Part", "Qty"], ["A", 1]]).recognised, false);
});

test("ship from tab name, else filename for a single sheet, else nothing", () => {
  const rows = [...H, ...job(1, "2026-09-21", "10:00:00", 1, "Insider", "Complete", 1, "09:59:00", "a.pdf", "09:58:59")];
  assert.equal(parseWorkbook([{ name: "Pursuit", rows }], "whatever.xlsx")[0].ship, "Pursuit");
  const one = parseWorkbook([{ name: "Sheet1", rows }], "Quest_Job_History_Sep.csv")[0];
  assert.equal(one.ship, "Quest");
  assert.equal(one.shipSource, "filename");
  assert.equal(parseWorkbook([{ name: "Sheet1", rows }], "job history.csv")[0].ship, null);
});

test("two ships named in one filename → no ship (the uploader picks)", () => {
  assert.equal(shipIn("Quest and Onward.xlsx"), null);
  assert.equal(shipIn("Azamara_Onward_2026.xlsx"), "Onward");
  assert.equal(shipIn("Questionnaire.pdf"), null);
});
