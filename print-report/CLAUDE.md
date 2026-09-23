# cims-print — press job history → print report

Read this before touching anything. Rules set by Miguel San Martín (GM, DG3 CIMS).

## What this is
A Cloudflare Worker + D1 at **hon.cims.work/print** (route `hon.cims.work/print*`,
attached in the dashboard, zone cims.work). Crew drop the AccurioPress C4070
job-history export; the report at `/print/report` shows machine hours, printing
vs stalled, working hours per press, what is printed, stalls, cancels, paper.
Its own worker and D1 (`cims-print`, `a6c4bf30-…`). It never reads or writes HON.

- `public/print/lib/` — the pure engine, shared by the pages and `test/`:
  `parse.js` (export → jobs), `classify.js` (file name → document type),
  `metrics.js` (normal speed, stalled, busy, working day, paper, $),
  `insights.js` (the "What stands out" cards, any grain, any slice).
- `src/worker.js` — API + cron. `src/watch.js` — the night watch.
- `src/cims-mast.js` — the estate letterhead, byte-identical (test checks the SHA1).

## Deploy
Push to `main` → GitHub Actions `print-report` → test → wrangler deploy.
**Proof of deploy is `/print/api/health` returning the new `VERSION`** (bump it in
`src/worker.js` with every change). Schema changes: add a numbered file in
`migrations/`, apply it to the live D1, add it to `test/helpers/d1.js`.

```bash
npm test                  # must be green
DB=/tmp/print.db npm run dev   # http://localhost:8788/print/
```

## The rules
1. **Nothing is invented.** Every number has a named source. The log has no
   operator, so hours are **machine time, never labour** — every surface says so.
   The log has no paper size, so boxes are **labelled as assumed** (tray rule in
   `metrics.PAPER`, one place).
2. **A null is an absence, a zero is a claim.** A job that never ran has no run
   time, not 0 s. A period with nothing before it gets no "vs last month" line.
3. **Every finding names its subject** — which ship, which dates, which document.
4. **Scope is never hidden.** The "Showing …" line states ships and dates; a
   narrowed view is flagged amber. (Miguel read a Pursuit-only custom-date view as
   "only one ship loaded" on 2026-09-23.)
5. **Stalled** = time beyond 1.5 × the ship's own normal (setup + s/sheet, measured
   from its completed jobs). Busy = printing + stalled exactly; overlaps count once.
6. **The night watch** (06:15 UTC) emails fails every day, warns only the first
   time. Never make it nag.

## Standing decisions — do not re-raise
- Repo/org placement (despensasupermercados vs a DG3 org) is **settled by Miguel.
  Never raise it again.**
- $ value (Azamara 2026 rate card, Brain `recSoDoerT7Orsnls`) stays off by default.
