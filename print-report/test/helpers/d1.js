// D1 stand-in over node:sqlite, so tests and the dev server run the real SQL.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function makeD1(file = ":memory:") {
  const db = new DatabaseSync(file);
  // Re-runnable on a persisted dev DB: an ALTER that already happened is skipped.
  for (const f of ["0001_jobs.sql", "0002_watch.sql", "0003_watch_sent.sql"]) {
    try { db.exec(readFileSync(new URL(`../../migrations/${f}`, import.meta.url), "utf8")); }
    catch (e) { if (!/duplicate column/.test(e.message)) throw e; }
  }
  const wrap = (sql, args = []) => ({
    sql, args,
    bind: (...a) => wrap(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return {
    prepare: (sql) => wrap(sql),
    batch: async (stmts) => {
      db.exec("BEGIN");
      try { const out = []; for (const s of stmts) out.push(await s.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; }
    },
    raw: db,
  };
}
