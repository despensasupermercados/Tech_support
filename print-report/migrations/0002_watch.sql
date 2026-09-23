-- Night watch: one row per run. checks = JSON array of {id,status,title,detail}.
CREATE TABLE IF NOT EXISTS watch_runs (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at    TEXT NOT NULL,
  trigger   TEXT NOT NULL,            -- cron | manual
  status    TEXT NOT NULL,            -- ok | warn | fail
  checks    TEXT NOT NULL,
  emailed   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS watch_runs_at ON watch_runs (ran_at);
