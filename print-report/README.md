# cims-print — press job history → print report

Drop the AccurioPress job-history export (.xlsx or .csv); read what the print
shop actually does: machine hours, printing vs stalled, what is printed, by
whom, how long each thing takes.

Live at **hon.cims.work/print** (upload) and **hon.cims.work/print/report**.
Reached from the printer icon on the handover page.

## Stack
- Cloudflare Worker `cims-print` — `src/worker.js`.
- Static pages — `public/print/` (`index.html` upload, `report.html` report).
- D1 `cims-print` `a6c4bf30-c41f-4120-ac28-e22119e8001b` — `migrations/0001_jobs.sql` (already applied).
- Its own worker and database. It never reads or writes a HON table.

## Pure engine — shared by the pages and the tests
| file | what it owns |
|---|---|
| `public/print/lib/parse.js` | the export's 4-row job block → one job; timestamps rebuilt from the END date; ship from tab name / file name, never guessed |
| `public/print/lib/classify.js` | file name → document type; dated editions folded into one document |
| `public/print/lib/metrics.js` | each ship's normal speed, printing vs stalled, merged busy time, billed value |

## Run it
```bash
npm install
npm test                                   # node --test, must be green
DB=/tmp/print.db npm run dev               # http://localhost:8788/print/
```

## One-time setup (Miguel, Cloudflare + GitHub)
1. GitHub → Tech_support → Settings → Secrets and variables → Actions →
   `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, D1: Edit, Account: Read).
   Until it exists the deploy job skips; tests still gate.
2. After the first deploy: Cloudflare → Workers & Pages → `cims-print` →
   Settings → Domains & Routes → **Add route** `hon.cims.work/print*`.
3. Check: `https://hon.cims.work/print/api/health` returns `"app":"cims-print"`.

## The numbers, and what they are not
- **Machine time, not labour.** The log has start and end per job, not who stood
  at the press. Every surface says so.
- **Stalled** = time past 1.5 × the ship's own normal time for that many sheets
  (setup + seconds per sheet, measured from its completed jobs). Busy = printing
  + stalled, exactly; overlapping jobs are counted once.
- **$ value** = billed value at the 2026 Azamara production rate card
  ($0.029030 colour / $0.007050 black per click — Brain `recSoDoerT7Orsnls`).
  Off by default.
