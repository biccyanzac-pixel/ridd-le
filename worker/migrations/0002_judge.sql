-- Server-side judge (scoring v6): verdict cache, quota counters, per-IP
-- limits, the paused-mode queue and the verdict log. All in D1 rather than
-- KV: the Workers KV free tier allows 1,000 writes a day in total, which the
-- cache, the counters and the rate limiter together would exhaust on a busy
-- day, while D1's free tier allows 100,000 writes a day.
--
-- Run once against local dev:
--   cd worker && npx wrangler d1 execute jacob-gg-leaderboard --local --file=migrations/0002_judge.sql
-- Run once against production, BEFORE deploying the worker that uses it:
--   cd worker && npx wrangler d1 execute jacob-gg-leaderboard --remote --file=migrations/0002_judge.sql

-- One verdict per (riddle, normalised answer), forever. Never expires. An
-- owner override replaces what is served without erasing what the model said.
CREATE TABLE IF NOT EXISTS judge_verdicts (
  cache_key         TEXT PRIMARY KEY,   -- <slug>:<normalised answer>, shared/judge-normalize.js
  slug              TEXT NOT NULL,
  normalized_answer TEXT NOT NULL,
  verdict           TEXT NOT NULL CHECK (verdict IN ('correct', 'close', 'wrong')),
  hint              TEXT,
  per_clue          TEXT NOT NULL,      -- JSON [{id, pass, reason}]
  model             TEXT NOT NULL,
  prompt_version    INTEGER NOT NULL,
  clues_revision    INTEGER NOT NULL,
  created_at        TEXT NOT NULL,
  flagged           INTEGER NOT NULL DEFAULT 0,   -- "wrong verdict?" presses
  override_verdict  TEXT CHECK (override_verdict IN ('correct', 'close', 'wrong')),
  override_hint     TEXT,
  override_at       TEXT
);
CREATE INDEX IF NOT EXISTS judge_verdicts_slug ON judge_verdicts (slug);
CREATE INDEX IF NOT EXISTS judge_verdicts_flagged ON judge_verdicts (flagged) WHERE flagged > 0;

-- Model calls per provider per UTC day. The 80% / 100% switches read this.
CREATE TABLE IF NOT EXISTS judge_quota (
  provider TEXT NOT NULL,
  day      TEXT NOT NULL,
  calls    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, day)
);

-- Uncached judge calls per (hashed IP, UTC hour). Cache hits are free.
CREATE TABLE IF NOT EXISTS judge_rate (
  ip_hash TEXT NOT NULL,
  hour    TEXT NOT NULL,
  calls   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, hour)
);

-- Answers accepted while judging was paused. Drained by the cron.
CREATE TABLE IF NOT EXISTS judge_queue (
  id            TEXT PRIMARY KEY,
  cache_key     TEXT NOT NULL,
  slug          TEXT NOT NULL,
  answer        TEXT NOT NULL,
  submission_id TEXT,                 -- the pending submissions row, if any
  created_at    TEXT NOT NULL,
  tries         INTEGER NOT NULL DEFAULT 0
);

-- Every verdict served, with inputs only. No player identifiers.
CREATE TABLE IF NOT EXISTS judge_log (
  id                TEXT PRIMARY KEY,
  day               TEXT NOT NULL,
  slug              TEXT NOT NULL,
  answer            TEXT NOT NULL,
  normalized_answer TEXT NOT NULL,
  verdict           TEXT NOT NULL,     -- correct | close | wrong | pending
  hint              TEXT,
  source            TEXT NOT NULL,     -- junk | cache | judge | paused | queue | prewarm | override
  model             TEXT,
  latency_ms        INTEGER,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS judge_log_day ON judge_log (day);

-- Submissions carry the verdict from v6 on. Pre-v6 rows keep NULLs.
ALTER TABLE submissions ADD COLUMN verdict TEXT;
ALTER TABLE submissions ADD COLUMN hint TEXT;
ALTER TABLE submissions ADD COLUMN cache_key TEXT;
-- 1 = scored; 0 = accepted while judging was paused, score to follow.
ALTER TABLE submissions ADD COLUMN judged INTEGER NOT NULL DEFAULT 1;
