import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { cleanJob } from "../src/worker.js";
import { makeD1 } from "./helpers/d1.js";

const env = () => ({ DB: makeD1(), ASSETS: { fetch: async () => new Response("asset") } });
const call = (e, path, body) => worker.fetch(new Request(`https://hon.cims.work${path}`, body ? { method: "POST", body: JSON.stringify(body) } : {}), e).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const job = (id, endTs) => ({ no: id, jobId: id, endTs, startTs: null, acceptTs: null, runS: null, waitS: null, mode: "Print", user: "Insider", result: "Cancel", feed: 0, color: 0, black: 0 });

test("an unknown ship is refused before anything is stored", async () => {
  const e = env();
  const r = await call(e, "/print/api/upload", { ship: "Atlantis", shipSource: "picked", fileName: "x" });
  assert.equal(r.status, 400);
});

test("re-dropping the same jobs adds nothing", async () => {
  const e = env();
  const a = (await call(e, "/print/api/upload", { ship: "Quest", shipSource: "tab", fileName: "a.xlsx" })).body.id;
  const jobs = [job(1, "2026-09-01 10:00:00"), job(2, "2026-09-01 11:00:00")];
  assert.equal((await call(e, `/print/api/upload/${a}/chunk`, { jobs })).body.added, 2);
  await call(e, `/print/api/upload/${a}/finish`, {});
  const b = (await call(e, "/print/api/upload", { ship: "Quest", shipSource: "tab", fileName: "b.xlsx" })).body.id;
  const r = await call(e, `/print/api/upload/${b}/chunk`, { jobs: [...jobs, job(3, "2026-09-02 10:00:00")] });
  assert.equal(r.body.added, 1);
  const s = await call(e, "/print/api/summary");
  assert.equal(s.body.ships[0].jobs, 3);
});

test("the same Job ID on two ships is two jobs", async () => {
  const e = env();
  for (const ship of ["Quest", "Onward"]) {
    const id = (await call(e, "/print/api/upload", { ship, shipSource: "tab", fileName: "a" })).body.id;
    await call(e, `/print/api/upload/${id}/chunk`, { jobs: [job(1, "2026-09-01 10:00:00")] });
  }
  assert.equal((await call(e, "/print/api/summary")).body.ships.length, 2);
});

test("jobs come back columnar with string dictionaries", async () => {
  const e = env();
  const id = (await call(e, "/print/api/upload", { ship: "Journey", shipSource: "tab", fileName: "a" })).body.id;
  await call(e, `/print/api/upload/${id}/chunk`, { jobs: [job(1, "2026-09-01 10:00:00"), job(2, "2026-09-01 11:00:00")] });
  const r = (await call(e, "/print/api/jobs?ship=Journey")).body;
  assert.equal(r.n, 2);
  assert.deepEqual(r.dicts.user, ["Insider"]);
  assert.deepEqual(r.data[r.cols.indexOf("user")], [0, 0]);
});

test("jobs carry an ETag; unchanged data is a 304, new jobs change it", async () => {
  const e = env();
  const id = (await call(e, "/print/api/upload", { ship: "Quest", shipSource: "tab", fileName: "a" })).body.id;
  await call(e, `/print/api/upload/${id}/chunk`, { jobs: [job(1, "2026-09-01 10:00:00")] });
  const get = (h) => worker.fetch(new Request("https://hon.cims.work/print/api/jobs?ship=Quest", { headers: h || {} }), e);
  const r1 = await get();
  const tag = r1.headers.get("etag");
  assert.ok(tag);
  assert.match(r1.headers.get("cache-control"), /no-cache/);
  assert.equal((await get({ "if-none-match": tag })).status, 304);
  await call(e, `/print/api/upload/${id}/chunk`, { jobs: [job(2, "2026-09-02 10:00:00")] });
  const r3 = await get({ "if-none-match": tag });
  assert.equal(r3.status, 200, "an interrupted upload still changes the version");
  assert.notEqual(r3.headers.get("etag"), tag);
  assert.equal((await r3.json()).n, 2);
});

test("with the KV cache: a new upload clears the version, the report sees it", async () => {
  const kv = new Map();
  const e = { ...env(), CACHE: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => void kv.set(k, v), delete: async (k) => void kv.delete(k) } };
  const id = (await call(e, "/print/api/upload", { ship: "Onward", shipSource: "tab", fileName: "a" })).body.id;
  await call(e, `/print/api/upload/${id}/chunk`, { jobs: [job(1, "2026-09-01 10:00:00")] });
  assert.equal((await call(e, "/print/api/jobs?ship=Onward")).body.n, 1);
  assert.equal(kv.get("v:Onward"), "1");
  assert.equal((await call(e, "/print/api/summary")).body.ships[0].jobs, 1);
  assert.ok(kv.has("summary"));
  await call(e, `/print/api/upload/${id}/chunk`, { jobs: [job(2, "2026-09-02 10:00:00")] });
  assert.ok(!kv.has("v:Onward") && !kv.has("summary"), "an upload that adds jobs clears the cache");
  assert.equal((await call(e, "/print/api/jobs?ship=Onward")).body.n, 2);
  assert.equal((await call(e, "/print/api/summary")).body.ships[0].jobs, 2);
  // a weak ETag from the edge still revalidates
  const r = await worker.fetch(new Request("https://hon.cims.work/print/api/jobs?ship=Onward", { headers: { "if-none-match": 'W/"Onward-2-c1"' } }), e);
  assert.equal(r.status, 304);
});

test("jobs the night watch would call impossible are refused one by one", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const ok = { jobId: 1, no: 1, endTs: "2026-09-21 10:00:00", startTs: "2026-09-21 09:50:00", runS: 600 };
  assert.ok(cleanJob(ok, now).row);
  for (const [bad, why] of [
    [{ endTs: "2026-02-30 10:00:00" }, "no 30 Feb"],
    [{ endTs: "2026-09-01 99:99:99" }, "no 99:99"],
    [{ endTs: ["2026-09-21 10:00:00"] }, "an array is not a time"],
    [{ startTs: null }, "start missing but a run time given"],
    [{ startTs: "2026-09-21 11:00:00", runS: 600 }, "starts after it ends"],
    [{ color: -5 }, "negative count"],
    [{ endTs: "2099-01-01 10:00:00", startTs: "2099-01-01 09:50:00" }, "future"],
    [{ endTs: "1999-01-01 10:00:00", startTs: "1999-01-01 09:50:00" }, "before 2020"],
  ]) assert.ok(cleanJob({ ...ok, ...bad }, now).error, why);
});

test("a chunk with one bad job still stores the good ones", async () => {
  const e = env();
  const id = (await call(e, "/print/api/upload", { ship: "Quest", shipSource: "tab", fileName: "a" })).body.id;
  const r = await call(e, `/print/api/upload/${id}/chunk`, { jobs: [job(1, "2026-09-01 10:00:00"), { ...job(2, "x"), endTs: ["2026-09-01 11:00:00"] }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.added, 1);
  assert.equal(r.body.refused, 1);
});

test("a server error comes back as JSON, not Cloudflare's error page; bad JSON is a 400", async () => {
  const e = env();
  const broken = { ...e, DB: { prepare: () => { throw new Error("D1_ERROR: boom"); } } };
  const r = await worker.fetch(new Request("https://hon.cims.work/print/api/summary"), broken);
  assert.equal(r.status, 500);
  assert.match((await r.json()).error, /D1_ERROR/);
  const r2 = await worker.fetch(new Request("https://hon.cims.work/print/api/upload", { method: "POST", body: "{not json" }), e);
  assert.equal(r2.status, 400);
});

test("a chunk whose bookkeeping fails still clears the ship's cached version", async () => {
  const kv = new Map([["v:Quest", "0"]]);
  const e = { ...env(), CACHE: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => void kv.set(k, v), delete: async (k) => void kv.delete(k) } };
  const id = (await call(e, "/print/api/upload", { ship: "Quest", shipSource: "tab", fileName: "a" })).body.id;
  kv.set("v:Quest", "0");
  const real = e.DB.prepare.bind(e.DB);
  const flaky = { ...e, DB: { ...e.DB, batch: e.DB.batch.bind(e.DB), prepare: (sql) => (sql.startsWith("UPDATE uploads SET rows_sent") ? { bind: () => ({ run: async () => { throw new Error("D1 hiccup"); } }) } : real(sql)) } };
  const r = await call(flaky, `/print/api/upload/${id}/chunk`, { jobs: [job(1, "2026-09-01 10:00:00")] });
  assert.equal(r.status, 500);
  assert.ok(!kv.has("v:Quest"), "the job was stored, so the cached version must go");
  assert.equal((await call(e, "/print/api/jobs?ship=Quest")).body.n, 1);
});

test("malformed jobs are refused one by one, not the chunk", () => {
  assert.ok(cleanJob({ jobId: 1, no: 1, endTs: "21/09/2026 10:00" }).error);
  assert.ok(cleanJob({ jobId: 1, no: 1, endTs: "2026-09-21 10:00:00", runS: 90000 }).error);
  assert.ok(cleanJob(job(1, "2026-09-21 10:00:00")).row);
});

test("non-API paths are static assets", async () => {
  const r = await worker.fetch(new Request("https://hon.cims.work/print/"), env());
  assert.equal(await r.text(), "asset");
});
