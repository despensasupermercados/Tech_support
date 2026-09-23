import { test } from "node:test";
import assert from "node:assert/strict";
import { category, docKey, dept } from "../public/print/lib/classify.js";

const c = (file, user = "Hotel", mode = "Print") => category({ file, user, mode });

test("the planner families, as the ships actually name them", () => {
  assert.equal(c("DAY 10 I AT SEA I SEPTEMBER 22, 2026.pdf", "Insider"), "Daily Planner");
  assert.equal(c("12 _ At Sea _ Friday, May 22, 2026.pdf", "Rest"), "Daily Planner");
  assert.equal(c("DAY 9 I LISBON, SPAIN I APRIL15, 2026.pdf", "Insider"), "Daily Planner");
  assert.equal(c("01_ Hong Kong _Tuesday, March 24, 2026 - Embarkation.pdf", "Insider"), "Daily Planner");
  assert.equal(c("DAY 10 I INSERT I AT SEA I SEPTEMBER 22, 2026.pdf", "Insider"), "Planner Insert");
  assert.equal(c("Crew Insider.pdf", "Insider"), "Crew Insider");
});

test("underscores do not hide words", () => {
  assert.equal(c("TopCruiser_Menu_LTR.pdf", "Menus"), "Menus");
});

test("order: invitation before menu, letter before planner, sales before planner", () => {
  assert.equal(c("ACAMAR_INVITE.pdf"), "Invitations");
  assert.equal(c("Day 2 at Sea JR260808 Itinerary change letter.pdf"), "Guest Letters & Info");
  assert.equal(c("DAY 2 - JUN 30 - ALL ROOMS - DAY-BY-DAY BOOKLET 260615.pdf", "CrSales"), "Sales Booklets");
});

test("a generic export name stays Other — content unknown", () => {
  assert.equal(c("PowerPoint Presentation.pdf", "Shorex"), "Other");
  assert.equal(c("Untitled-2.pdf", "BOM"), "Other");
  assert.equal(c(null, "BOM"), "Other");
});

test("machine activity is its own family", () => {
  assert.equal(c(null, "Hotel", "Test Pattern"), "Test Pattern / Copy");
  assert.equal(c("x", "Hotel", "Copy"), "Test Pattern / Copy");
});

test("docKey folds dated editions of one document together", () => {
  assert.equal(docKey("DAY 10 I AT SEA I SEPTEMBER 22, 2026.pdf"), docKey("DAY 11 I AT SEA I SEPTEMBER 23, 2026.pdf"));
  assert.equal(docKey("Microsoft Word - Discoveries Bar Menu"), "discoveries bar menu");
});

test("department names fold case but are never expanded", () => {
  assert.equal(dept("INSIDER"), "Insider");
  assert.equal(dept("CRSALES"), "CrSales");
  assert.equal(dept("BOM"), "BOM");
});
