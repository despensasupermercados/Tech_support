import { test } from "node:test";
import assert from "node:assert/strict";
import { datedPlace, placeZone, itinerary, shipClock, toUtc, offsetMin, utcLabel, PRESS_TZ } from "../public/print/lib/shiptime.js";

test("the ships' own file names give port + date, in every house style", () => {
  assert.deepEqual(datedPlace("DAY 9 I LISBON, SPAIN I APRIL15, 2026.pdf"), { date: "2026-04-15", place: "LISBON, SPAIN" });
  assert.deepEqual(datedPlace("01_ Sydney, Australia _Tuesday, March 3, 2026 - Embarkation.pdf"), { date: "2026-03-03", place: "Sydney, Australia" });
  assert.deepEqual(datedPlace("01_ Embarkation _ Melbourne, Australia _ January 4, 2026 - PG.pdf"), { date: "2026-01-04", place: "Melbourne, Australia" });
  assert.deepEqual(datedPlace("DAY 4 I INSERT I SANTOS (SAO PAOLO), BRAZIL I FEBRUARY, 3 2026.pdf"), { date: "2026-02-03", place: "SANTOS (SAO PAOLO), BRAZIL" });
  assert.deepEqual(datedPlace("DAY 10 _ INSERT BELFAST, NORTHERN IRELAND, UK I AUG 16, 2026 + AAE.pdf"), { date: "2026-08-16", place: "INSERT BELFAST, NORTHERN IRELAND, UK" });
  assert.equal(datedPlace("Birthday Cards.pdf"), null);
  assert.equal(datedPlace("DAY 4 - JUNE 21 -276 UNITS- AZA Circle Event.pdf"), null, "no year → not a dated port");
  assert.equal(datedPlace("10-Night Alaska Cruise Ketchikan, Juneau & Hubbard Glacier May 21, 2026.pdf"), null, "a sailing title is not where the ship is");
});

test("port → zone: the specific place beats the country, whole words only", () => {
  assert.equal(placeZone("Basseterre, Saint Kitts-Nevis"), "America/St_Kitts", "not Sète");
  assert.equal(placeZone("Venice (Fusina), Italy"), "Europe/Rome", "not Nice");
  assert.equal(placeZone("Portofino (Santa Margherita), Italy"), "Europe/Rome", "not Porto");
  assert.equal(placeZone("Stockholm, Sweden"), "Europe/Stockholm", "not Eden, Australia");
  assert.equal(placeZone("CABO ROJO, DOMINICAN REPUBLIC"), "America/Santo_Domingo", "not Dominica");
  assert.equal(placeZone("ST JOHNS ANTIGUA"), "America/Antigua", "not Newfoundland");
  assert.equal(placeZone("St. John's, Newfoundland, Canada"), "America/St_Johns");
  assert.equal(placeZone("Kuala Lumpur, Indonesia"), "Asia/Kuala_Lumpur");
  assert.equal(placeZone("Las Palmas, Gran Canaria, Spain"), "Atlantic/Canary");
  assert.equal(placeZone("Benoa, Bali, Indonesia"), "Asia/Makassar");
  assert.equal(placeZone("Perth, Australia"), "Australia/Perth");
  assert.equal(placeZone("Juneau, Alaska"), "America/Anchorage");
  assert.equal(placeZone("At Sea Hubbard Glacier"), "America/Anchorage");
  assert.equal(placeZone("At Sea"), null);
  assert.equal(placeZone("Hosting Table ACD"), null);
});

test("the press clock is fixed UTC−5 — it does not spring forward", () => {
  assert.equal(PRESS_TZ, "Etc/GMT+5");
  // 10:00 on the press is 15:00 UTC in January and still 15:00 UTC in July
  assert.equal(new Date(toUtc("2026-01-15 10:00:00", PRESS_TZ)).toISOString(), "2026-01-15T15:00:00.000Z");
  assert.equal(new Date(toUtc("2026-07-15 10:00:00", PRESS_TZ)).toISOString(), "2026-07-15T15:00:00.000Z");
  assert.equal(utcLabel(offsetMin("Europe/Lisbon", Date.parse("2026-07-01T12:00:00Z"))), "UTC+1");
  assert.equal(utcLabel(offsetMin("America/St_Johns", Date.parse("2026-08-20T12:00:00Z"))), "UTC−2:30");
});

const J = (endTs, file = null) => ({ endTs, file });

test("itinerary: documents place the day; a gap carries the nearest port, marked", () => {
  const it = itinerary([
    J("2026-04-06 20:00:00", "DAY 2 I LISBON, PORTUGAL I APRIL 7, 2026.pdf"),
    J("2026-04-08 20:00:00", "DAY 4 I SEVILLE, SPAIN I APRIL 9, 2026.pdf"),
    J("2026-04-12 09:00:00", "Birthday Cards.pdf"),
    // an old template reprinted months later is not where the ship is
    J("2026-04-12 10:00:00", "DAY 7 I PHILIPSBURG, SINT MAARTEN I DECEMBER 4, 2025.pdf"),
  ]);
  assert.equal(it.days.get("2026-04-07").tz, "Europe/Lisbon");
  assert.equal(it.days.get("2026-04-07").how, "port");
  assert.equal(it.days.get("2026-04-09").tz, "Europe/Madrid");
  assert.equal(it.days.get("2026-04-08").how, "carried", "between two different zones → carried, not claimed");
  assert.equal(it.days.get("2026-04-12").tz, "Europe/Madrid");
  assert.equal(it.days.get("2026-04-12").how, "carried");
  assert.ok(![...it.days.values()].some((e) => e.tz === "America/Lower_Princes"));
});

test("ship clock: press 20:00 (UTC−5) in Tokyo is 10:00 next day; in Lisbon summer 02:00", () => {
  const tokyo = shipClock(itinerary([J("2026-05-07 06:00:00", "01_ INSERT _ Embarkation _ Tokyo, Japan _ May 9, 2026.pdf"), J("2026-05-10 20:00:00")]));
  assert.deepEqual(tokyo("2026-05-09 20:00:00"), { ts: "2026-05-10 10:00:00", tz: "Asia/Tokyo", how: "carried" });
  const lis = shipClock(itinerary([J("2026-07-01 08:00:00", "DAY 2 I LISBON, PORTUGAL I JULY 1, 2026.pdf")]));
  assert.equal(lis("2026-07-01 20:00:00").ts, "2026-07-02 02:00:00");
  assert.equal(lis("2026-07-01 08:00:00").ts, "2026-07-01 14:00:00");
  // nothing known → the press clock, said so
  const none = shipClock(itinerary([J("2026-07-01 08:00:00", "Birthday Cards.pdf")]));
  assert.deepEqual(none("2026-07-01 08:00:00"), { ts: "2026-07-01 08:00:00", tz: PRESS_TZ, how: "press" });
});
