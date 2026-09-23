// D1 stand-in over node:sqlite, so tests and the dev server run the real SQL.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";

export function makeD1(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec(readFileSync(new URL("../../migrations/0001_jobs.sql", import.meta.url), "utf8"));
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
