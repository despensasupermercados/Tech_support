-- Which fail checks a run emailed (JSON array of ids), so a problem is emailed
-- once and then at most every 7 days while it persists.
ALTER TABLE watch_runs ADD COLUMN sent TEXT;
