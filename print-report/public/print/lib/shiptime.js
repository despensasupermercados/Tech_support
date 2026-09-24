// Ship time — turn the press clock into the time on board.
//
// The C4070 stamps every job with its own clock, and that clock does not follow
// the ship: on every hull it runs on Miami winter time, UTC−5, all year — it
// does not spring forward. Evidence, from the log itself (2026-09-23):
//  · Quest in the Caribbean in January works 08–20 on the press clock, i.e.
//    09–21 on board; read as UTC it would be 04–16.
//  · As each ship moves, its quiet hours drift across the press clock by exactly
//    the time-zone change.
//  · Across the US clock change (8 Mar 2026) Pursuit (Asia) and Onward
//    (Queensland), both in zones without summer time, start work at the same
//    ship-time hour if the press is read as fixed UTC−5 (10.5→10.6, 11.1→11.2),
//    and jump an hour early if read as New York time (10.5→9.6, 11.1→10.2).
//
// Where the ship was is not invented either: every ship prints its own day
// planners, inserts and embarkation letters, and their file names carry the port
// and the date ("DAY 9 I LISBON, SPAIN I APRIL 15, 2026",
// "01_ Sydney, Australia _Tuesday, March 3, 2026 - Embarkation"). The port gives
// the zone (IANA tz database — the same rule a phone uses), the zone gives the
// clock. A day with no dated port on file borrows the nearest one and is marked
// as estimated — never shown as fact.
//
// Pure: used by the report page and by test/.

// IANA writes UTC−5 as "Etc/GMT+5" (the sign is POSIX, inverted).
export const PRESS_TZ = "Etc/GMT+5";

// Place → IANA zone. First match wins, so the specific (a city, an island, a
// state) comes before the general (the country). A country that spans zones
// (USA, Canada, Australia, Indonesia, Spain, Portugal, Chile, Mexico…) is only
// matched through its places. Extend when the report lists an unplaced port.
const ZONES = [
  // ---- places that would be caught by the wrong general rule
  [/kuala lumpur|port klang|penang|langkawi|malaysia/, "Asia/Kuala_Lumpur"],
  [/kusadasi|ephesus|turkey|istanbul|canakkale|bodrum|marmaris/, "Europe/Istanbul"],
  [/gibraltar/, "Europe/Gibraltar"],
  [/canary|canarias|gran canaria|lanzarote|arrecife|la palma|las palmas|tenerife|fuerteventura|la gomera/, "Atlantic/Canary"],
  [/azores|horta|ponta delgada|praia da vitoria/, "Atlantic/Azores"],
  [/funchal|madeira|porto santo/, "Atlantic/Madeira"],
  [/easter island|hanga roa/, "Pacific/Easter"],
  [/galapagos/, "Pacific/Galapagos"],
  [/seychelles|port victoria|mahe/, "Indian/Mahe"],
  [/nova scotia|halifax|charlottetown|prince edward|new brunswick|saint john, nb/, "America/Halifax"],
  [/bermuda/, "Atlantic/Bermuda"],
  [/newfoundland|corner brook/, "America/St_Johns"],
  [/british columbia|vancouver|nanaimo|prince rupert/, "America/Vancouver"],
  [/quebec|montreal|saguenay|havre[- ,]+s(?:ain)?t\.?[- ]pierre|gaspe|trois-rivieres|toronto/, "America/Toronto"],
  [/st\.? pierre et|saint-pierre et|miquelon/, "America/Miquelon"],
  [/alaska|juneau|ketchikan|skagway|sitka|haines|icy strait|iccy strait|hubbard|endicott|seward|whittier|valdez|kodiak|wrangell|klawock|dutch harbor|glacier bay|college fjord|tracy arm|anchorage/, "America/Anchorage"],
  [/hawaii|honolulu|\bhilo\b|\bkona\b|lahaina|maui|kauai|nawiliwili/, "Pacific/Honolulu"],
  [/cozumel|costa maya|cancun|playa del carmen/, "America/Cancun"],
  [/progreso|merida/, "America/Merida"],
  [/puerto vallarta|mazatlan|cabo san lucas/, "America/Mazatlan"],
  [/perth|fremantle|busselton|albany|esperance|broome|geraldton|exmouth/, "Australia/Perth"],
  [/adelaide|kangaroo island|port lincoln/, "Australia/Adelaide"],
  [/darwin/, "Australia/Darwin"],
  [/queensland|brisbane|cairns|airlie|whitsunday|moolool?aba|moolooba|townsville|gladstone|port douglas/, "Australia/Brisbane"],
  [/tasmania|hobart|burnie|port arthur/, "Australia/Hobart"],
  [/sydney|melbourne|\beden\b|newcastle, australia|new south wales|australia/, "Australia/Sydney"],
  [/bali|benoa|celukan|lombok|komodo|makassar|sulawesi/, "Asia/Makassar"],
  [/indonesia|semarang|surabaya|sabang|jakarta|tanjung priok/, "Asia/Jakarta"],
  [/belem|santarem/, "America/Belem"],
  [/manaus|boca da valeria|parintins/, "America/Manaus"],
  [/nuku hiva|marquesas/, "Pacific/Marquesas"],
  [/pitcairn/, "Pacific/Pitcairn"],
  [/virgin islands|vigrin islands|st\.? thomas|charlotte amalie/, "America/St_Thomas"],
  [/puerto rico|san juan/, "America/Puerto_Rico"],
  [/miami|florida|fort lauderdale|port everglades|new york|boston|baltimore|\bcharleston\b|norfolk/, "America/New_York"],
  [/saint-pierre, martinique|martinique|fort-de-france/, "America/Martinique"],
  [/pointe des galets|reunion/, "Indian/Reunion"],
  [/french gu?iana|french guana|isle royale|iles du salut|cayenne/, "America/Cayenne"],
  [/port louis|mauritius/, "Indian/Mauritius"],
  [/mayott?e|mamoudzou/, "Indian/Mayotte"],
  [/st\.? helena|saint helena|jamestown/, "Atlantic/St_Helena"],
  [/falkland|port stanley/, "Atlantic/Stanley"],
  [/greenland|nuuk|qaqortoq|paamiut|nanortalik|prince christian|narsaq/, "America/Nuuk"],
  [/faroe|torshavn|runavik|klaksvik/, "Atlantic/Faroe"],
  [/isle of man|douglas/, "Europe/Isle_of_Man"],
  [/guernsey|st\.? peter port|saint peter port/, "Europe/Guernsey"],
  [/jersey|st\.? helier/, "Europe/Jersey"],
  [/tahiti|papeete|papetee|bora bora|moorea|fakarava|raiatea|huahine|rangiroa|french polynesia/, "Pacific/Tahiti"],
  [/hong kong/, "Asia/Hong_Kong"],
  [/singapore/, "Asia/Singapore"],
  [/monaco|monte carlo/, "Europe/Monaco"],
  [/malta|valletta|gozo/, "Europe/Malta"],
  // ---- one zone per country
  [/new zealand|auckland|wellington|christchurch|dunedin|napier|tauranga|picton|nelson|gisborne|bay of islands|milford sound|akaroa/, "Pacific/Auckland"],
  [/japan|tokyo|kobe|osaka|yokohama|nagasaki|hiroshima|okinawa|naha|hakodate|aomori|akita|kanazawa|niigata|kochi|takamatsu|maizuru|sakata|toyama|shimizu|hirara|sakaiminato|kitakyushu/, "Asia/Tokyo"],
  [/korea|busan|incheon|jeju/, "Asia/Seoul"],
  [/taiwan|keelung|kaohsiung/, "Asia/Taipei"],
  [/philippines|manila/, "Asia/Manila"],
  [/vietnam|ho ch[io] minh|da nang|danang|ha long|halong|nha trang|phu my|\bhue\b/, "Asia/Ho_Chi_Minh"],
  [/thailand|laem chabang|ko samui|koh samui|phuket|bangkok/, "Asia/Bangkok"],
  [/cambodia|sihanoukville/, "Asia/Phnom_Penh"],
  [/myanmar|yangon/, "Asia/Yangon"],
  [/sri lanka|colombo|hambantota|trincomalee/, "Asia/Colombo"],
  [/india|cochin|kochi, india|mumbai|\bgoa\b|mormugao|chennai/, "Asia/Kolkata"],
  [/maldives|\bmale\b/, "Indian/Maldives"],
  [/palau|koror/, "Pacific/Palau"],
  [/papua new guinea|alotau|madang|rabaul|port moresby/, "Pacific/Port_Moresby"],
  [/fiji|suva|lautoka/, "Pacific/Fiji"],
  [/new caledonia|noumea/, "Pacific/Noumea"],
  [/vanuatu|port vila/, "Pacific/Efate"],
  [/oman|muscat|salalah|khasab/, "Asia/Muscat"],
  [/dubai|abu dhabi|emirates|uae/, "Asia/Dubai"],
  [/qatar|doha/, "Asia/Qatar"],
  [/israel|haifa|ashdod/, "Asia/Jerusalem"],
  [/jordan|aqaba/, "Asia/Amman"],
  [/egypt|alexandria|port said|safaga|sokhna/, "Africa/Cairo"],
  [/cyprus|limassol|larnaca/, "Asia/Nicosia"],
  [/south africa|cape town|durban|port elizabeth|gqeberha|mossel bay|richards bay|east london/, "Africa/Johannesburg"],
  [/namibia|walvis bay|luderitz/, "Africa/Windhoek"],
  [/madagascar|nosy[- ]be|antsiranana|taolagnaro|toamasina/, "Indian/Antananarivo"],
  [/kenya|mombasa|lamu/, "Africa/Nairobi"],
  [/tanzania|zanzibar|dar es salaam/, "Africa/Dar_es_Salaam"],
  [/mozambique|maputo/, "Africa/Maputo"],
  [/gambia|banjul/, "Africa/Banjul"],
  [/senegal|dakar/, "Africa/Dakar"],
  [/cape verde|praia|mindelo/, "Atlantic/Cape_Verde"],
  [/morocco|mnorocco|casablanca|casblanca|agadir|tangier|safi/, "Africa/Casablanca"],
  [/tunisia|la goul+ette|tunis|sousse/, "Africa/Tunis"],
  [/iceland|reykjavik|isafjordur|akureyri|grundarfjordur|seydisfjordur/, "Atlantic/Reykjavik"],
  [/northern ireland|belfast/, "Europe/London"],
  [/ireland|dublin|cork|cobh|waterford|bantry|foynes|killybegs|donegal|galway/, "Europe/Dublin"],
  [/\buk\b|united kingdom|england|scotland|wales|london|southampton|dover|portsmouth|liverpool|holyhead|oban|kirkwall|lerwick|invergordon|ullapool|leith|edinburgh|glasgow|greenock|aberdeen|dundee|falmouth/, "Europe/London"],
  [/portugal|potugal|lisbon|lisbonportugal|\bporto\b|leixoes|leixos|portimao/, "Europe/Lisbon"],
  [/spain|barcelona|malaga|cadiz|seville|valencia|alicante|palamos|palma|mahon|menorca|ibiza|cartagena, spain|bilbao|ferrol|vigo|melilla|almeria|rosas|san sebastian|a coruna/, "Europe/Madrid"],
  [/france|framce|marseille|provence|\bnice\b|villefranche|cannes|tropez|sete|calvi|bastia|ajaccio|bonifacio|corsica|honfleur|le havre|cherbourg|saint[- ]malo|bordeaux|rouen|port[- ]?vendres|toulon|sanary|menton/, "Europe/Paris"],
  [/italy|italia|\brome\b|civitavecchia|naples|sorrento|amalfi|capri|livorno|florence|florencepisa|pisa|portofino|santa margherita|venice|fusina|trieste|taormina|messina|catania|siracusa|sicily|cagliari|sardinia|crotone|portoferraio|elba|ravenna|genoa/, "Europe/Rome"],
  [/croatia|dubrovnik|split|korcula|hvar|zadar|sibenik|opatija|rovinj|\bpula\b/, "Europe/Zagreb"],
  [/slovenia|koper|piran/, "Europe/Ljubljana"],
  [/montenegro|kotor|budva/, "Europe/Podgorica"],
  [/albania|sarande|durres/, "Europe/Tirane"],
  [/greece|athens|piraeus|santorini|mykonos|rhodes|crete|heraklion|chania|agios nikolaos|corfu|katakolon|nafplio|monemvasia|movemvasia|patmos|paros|syros|volos|thessaloniki|chios|kefalonia|zakynthos/, "Europe/Athens"],
  [/netherlands|amsterdam|ijmuiden|rotterdam/, "Europe/Amsterdam"],
  [/belgium|zeebrugge|antwerp/, "Europe/Brussels"],
  [/germany|hamburg|kiel|warnemunde|bremerhaven/, "Europe/Berlin"],
  [/denmark|copenhagen|skagen|fredericia|aarhus|aalborg/, "Europe/Copenhagen"],
  [/norway|oslo|bergen|eidfjord|\bflam\b|geiranger|haugesund|kristiansand|stavanger|alesund|\balta\b|bodo|harstad|honningsvag|molde|olden|rosendal|svolvaer|lofoten|tromso|trondheim/, "Europe/Oslo"],
  [/sweden|stockholm|gothenburg|visby/, "Europe/Stockholm"],
  [/mariehamn|aland/, "Europe/Mariehamn"],
  [/finland|helsinki|turku/, "Europe/Helsinki"],
  [/estonia|tallinn/, "Europe/Tallinn"],
  [/latvia|riga/, "Europe/Riga"],
  [/lithuania|klaipeda/, "Europe/Vilnius"],
  [/poland|gdansk|gdynia/, "Europe/Warsaw"],
  [/barbados|bridgetown/, "America/Barbados"],
  [/grenada|saint georges|st\.? george'?s/, "America/Grenada"],
  [/antigua|st\.? johns antigua/, "America/Antigua"],
  [/kitts|nevis|basseterre|charlestown/, "America/St_Kitts"],
  [/sint maarten|st\.? maarten|philipsburg/, "America/Lower_Princes"],
  [/tortola|road ?town|british virgin|virgin gorda/, "America/Tortola"],
  [/saint vincent|st\.? vincent|bequia|grenadines/, "America/St_Vincent"],
  [/st\.? lucia|saint lucia|castries/, "America/St_Lucia"],
  [/\bdominica\b|roseau/, "America/Dominica"],
  [/guadeloupe/, "America/Guadeloupe"],
  [/st\.? barth|gustavia/, "America/St_Barthelemy"],
  [/trinidad|tobago|scarborough/, "America/Port_of_Spain"],
  [/aruba|oranjestad/, "America/Aruba"],
  [/curacao|willemstad/, "America/Curacao"],
  [/bonaire|kralendijk/, "America/Kralendijk"],
  [/dominican republic|cabo rojo|la romana|samana|puerto plata/, "America/Santo_Domingo"],
  [/bahamas|nassau/, "America/Nassau"],
  [/jamaica|montego|ocho rios|falmouth, jamaica/, "America/Jamaica"],
  [/cayman|george town/, "America/Cayman"],
  [/belize/, "America/Belize"],
  [/honduras|roatan/, "America/Tegucigalpa"],
  [/guatemala/, "America/Guatemala"],
  [/costa rica|puntarenas|limon/, "America/Costa_Rica"],
  [/panama|fuerte amador|puerte amador|\bcolon\b|bocas del toro|san blas/, "America/Panama"],
  [/colombia|cartagena|santa marta/, "America/Bogota"],
  [/ecuador|guayaquil|manta/, "America/Guayaquil"],
  [/peru|\blima\b|callao|pisco|salaverry|trujillo/, "America/Lima"],
  [/chile|arica|la serena|coquimbo|valparaiso|san antonio|puerto montt|punta arenas|iquique/, "America/Santiago"],
  [/argentina|buenos aires|ushuaia|puerto madryn/, "America/Argentina/Buenos_Aires"],
  [/uruguay|montevideo|punta del este/, "America/Montevideo"],
  [/brazil|rio de janeiro|santos|sao paulo|buzios|ilhabela|paraty|salvador|bahia|recife|fortaleza|maceio/, "America/Sao_Paulo"],
  [/mexico/, "America/Mexico_City"],
].map(([rx, tz]) => [new RegExp(`(?<![a-z])(?:${rx.source})(?![a-z])`), tz]); // whole words only: "Basseterre" is not Sète

// A place name → zone, or null. "At sea" is not a place.
const PZ = new Map();
export function placeZone(place) {
  const k = String(place || "");
  if (!PZ.has(k)) PZ.set(k, placeZone0(k));
  return PZ.get(k);
}
function placeZone0(place) {
  const p = String(place || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!p || /\bat sea\b|sea ?day|cruising|scenic/.test(p) && !/hubbard|endicott|prince christian|panama canal/.test(p)) return null;
  for (const [rx, tz] of ZONES) if (rx.test(p)) return tz;
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MON_RX = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_RX = new RegExp(`${MON_RX}\\.?\\s*,?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(20\\d\\d)`, "i");
const WEEKDAY = /(?<![a-z])(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b[,.]?\s*$/i;

// A document file name → { date, place } when it names a port and a full date.
const DP = new Map();
export function datedPlace(file) {
  if (!file) return null;
  if (DP.has(file)) return DP.get(file);
  const r = datedPlace0(file); DP.set(file, r); return r;
}
function datedPlace0(file) {
  const m = DATE_RX.exec(file);
  if (!m) return null;
  const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
  const day = +m[2];
  if (mon < 0 || day < 1 || day > 31) return null;
  const date = `${m[3]}-${String(mon + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // the place is the segment just before the date
  const trim = (x) => x.replace(/(?:[\s_|,\-–]|\s[Il](?=\s*$))+$/, "");
  const head = trim(trim(file.slice(0, m.index)).replace(WEEKDAY, ""));
  const parts = head.split(/\s+I\s+|\s+l\s+|\s*_\s*|\s+-\s+|\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  const place = parts[parts.length - 1] || "";
  // a sailing title ("10-Night Alaska Cruise Ketchikan, Juneau…") names a voyage, not where the ship is that day
  if (!place || /\bcruise\b|\d+[- ]nights?\b/i.test(place)) return null;
  return { date, place };
}

const DAY_MS = 86400000;
const dayMs = (d) => Date.parse(d + "T00:00:00Z");
const isoDay = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => isoDay(dayMs(d) + n * DAY_MS);

// jobs [{ endTs (press clock), file }] of ONE ship → the ship's day-by-day zone.
//   days: Map 'YYYY-MM-DD' → { tz, place, how }   how: port | between | carried
//   unplaced: place names seen in dated documents that have no zone rule
// A document counts only when it was printed from 14 days before its date to
// 2 days after — a reused old template is not where the ship is.
export function itinerary(jobs) {
  const votes = new Map();
  const unplaced = new Map();
  let first = null, last = null;
  for (const j of jobs) {
    const pd = j.endTs.slice(0, 10);
    if (!first || pd < first) first = pd;
    if (!last || pd > last) last = pd;
    const dp = datedPlace(j.file);
    if (!dp) continue;
    const lag = (dayMs(dp.date) - dayMs(pd)) / DAY_MS;
    if (lag < -2 || lag > 14) continue;
    const tz = placeZone(dp.place);
    if (!tz) {
      if (!/\bat sea\b|insert|debark|embark|^day\b|combo|plan b|untitled|merge|menu/i.test(dp.place)) unplaced.set(dp.place, (unplaced.get(dp.place) || 0) + 1);
      continue;
    }
    let v = votes.get(dp.date);
    if (!v) votes.set(dp.date, (v = new Map()));
    const e = v.get(tz) || { n: 0, place: dp.place };
    e.n++;
    v.set(tz, e);
  }
  const known = new Map();
  for (const [d, v] of votes) {
    const [tz, e] = [...v.entries()].sort((a, b) => b[1].n - a[1].n)[0];
    known.set(d, { tz, place: e.place, how: "port" });
  }
  const days = new Map();
  if (!first) return { days, unplaced, first, last };
  // run from a day before the first job (ships ahead of Miami) to a day after the last
  const from = addDays(first, -1), to = addDays(last, 1);
  const keys = [...known.keys()].sort();
  let k = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    while (k < keys.length && keys[k] < d) k++;
    if (known.has(d)) { days.set(d, known.get(d)); continue; }
    const prev = k > 0 ? known.get(keys[k - 1]) : null;
    const next = k < keys.length ? known.get(keys[k]) : null;
    if (prev && next && prev.tz === next.tz) days.set(d, { tz: prev.tz, place: prev.place, how: "between" });
    else if (prev || next) { const n = prev || next; days.set(d, { tz: n.tz, place: n.place, how: "carried" }); }
  }
  return { days, unplaced, first, last };
}

// ---- clocks
const FMT = new Map();
function fmt(tz) {
  let f = FMT.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    FMT.set(tz, f);
  }
  return f;
}
const OFF = new Map();   // tz → Map(hour number → minutes)
// "Etc/GMT+5" is a fixed offset (−300 min) — no calendar lookup needed
const FIXED = (tz) => { const m = /^Etc\/GMT([+-])(\d{1,2})$/.exec(tz); return m ? (m[1] === "+" ? -1 : 1) * +m[2] * 60 : null; };
// minutes east of UTC for tz at the instant utcMs (cached per zone-hour)
export function offsetMin(tz, utcMs) {
  let byHour = OFF.get(tz);
  if (!byHour) { byHour = new Map(); OFF.set(tz, byHour); const f = FIXED(tz); if (f != null) byHour.fixed = f; }
  if (byHour.fixed != null) return byHour.fixed;
  // a zone's offset only moves at a summer-time change: cache it per UTC day when
  // both ends of the day agree, per hour only on the two change days a year
  const day = Math.floor(utcMs / 86400000);
  let o = byHour.get("d" + day);
  if (o != null) return o;
  if (!byHour.has("x" + day)) {
    // start of day = end of the day before, which is usually already known
    let a = byHour.get("e" + (day - 1));
    if (a == null) a = offsetAt(tz, day * 86400000);
    const b = offsetAt(tz, day * 86400000 + 86399000);
    byHour.set("e" + day, b);
    if (a === b) { byHour.set("d" + day, a); return a; }
    byHour.set("x" + day, true);
  }
  const key = Math.floor(utcMs / 3600000);
  o = byHour.get(key);
  if (o != null) return o;
  o = offsetAt(tz, utcMs);
  byHour.set(key, o);
  return o;
}
function offsetAt(tz, utcMs) {
  let o;
  const p = {};
  for (const x of fmt(tz).formatToParts(new Date(utcMs))) p[x.type] = x.value;
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  o = Math.round((wall - Math.floor(utcMs / 1000) * 1000) / 60000);
  return o;
}

const wallMs = (ts) => Date.parse(ts.replace(" ", "T") + "Z");
const wallTs = (t) => new Date(t).toISOString().slice(0, 19).replace("T", " ");

// 'YYYY-MM-DD HH:MM:SS' on clock tz → the UTC instant
export function toUtc(ts, tz) {
  const w = wallMs(ts);
  let u = w - offsetMin(tz, w) * 60000;
  u = w - offsetMin(tz, u) * 60000; // settle across a DST edge
  return u;
}

// One ship's converter: press-clock stamp → { ts (ship time), tz, how }.
export function shipClock(itin, pressTz = PRESS_TZ) {
  return (pressTs) => {
    const u = toUtc(pressTs, pressTz);
    let e = itin.days.get(pressTs.slice(0, 10));
    if (!e) return { ts: pressTs, tz: pressTz, how: "press" };
    let local = wallTs(u + offsetMin(e.tz, u) * 60000);
    const e2 = itin.days.get(local.slice(0, 10));
    if (e2) { if (e2.tz !== e.tz) local = wallTs(u + offsetMin(e2.tz, u) * 60000); e = e2; }
    return { ts: local, tz: e.tz, how: e.how };
  };
}

// Short label for a zone: "UTC+9", "UTC−3:30"
export function utcLabel(min) {
  const s = min < 0 ? "−" : "+", a = Math.abs(min);
  return `UTC${s}${Math.floor(a / 60)}${a % 60 ? ":" + String(a % 60).padStart(2, "0") : ""}`;
}
