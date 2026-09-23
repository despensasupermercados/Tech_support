-- cims-print — press job log, one row per job, every upload merged.
-- A job is keyed on ship + press Job ID + end time: Job IDs repeat across ships,
-- and re-dropping an overlapping export must add nothing (INSERT OR IGNORE).

CREATE TABLE IF NOT EXISTS uploads (
  id          TEXT PRIMARY KEY,           -- uuid
  file_name   TEXT NOT NULL,
  sheet       TEXT,
  ship        TEXT NOT NULL,
  ship_source TEXT NOT NULL,              -- tab | filename | picked
  rows_sent   INTEGER NOT NULL DEFAULT 0,
  rows_added  INTEGER NOT NULL DEFAULT 0,
  day_from    TEXT,
  day_to      TEXT,
  started_at  TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS jobs (
  ship      TEXT    NOT NULL,
  job_id    INTEGER NOT NULL,
  end_ts    TEXT    NOT NULL,             -- 'YYYY-MM-DD HH:MM:SS', press clock = ship time
  start_ts  TEXT,                         -- NULL = the press never ran it
  accept_ts TEXT,
  run_s     INTEGER,                      -- NULL with start_ts
  wait_s    INTEGER,
  log_no    INTEGER NOT NULL,
  mode      TEXT,
  user      TEXT,
  result    TEXT,
  tray      TEXT,
  pages     INTEGER,
  sheets    INTEGER,
  sets      INTEGER,
  out_sets  INTEGER,
  color     INTEGER NOT NULL DEFAULT 0,
  black     INTEGER NOT NULL DEFAULT 0,
  mono      INTEGER NOT NULL DEFAULT 0,
  feed      INTEGER NOT NULL DEFAULT 0,
  exit_n    INTEGER NOT NULL DEFAULT 0,
  waste     INTEGER NOT NULL DEFAULT 0,
  file      TEXT,
  upload_id TEXT NOT NULL,
  PRIMARY KEY (ship, job_id, end_ts)
);

CREATE INDEX IF NOT EXISTS jobs_ship_end ON jobs (ship, end_ts);
