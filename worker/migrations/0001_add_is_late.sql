-- Adds the is_late column needed by the archive/replay feature to an
-- existing submissions table. schema.sql already includes this column for a
-- brand-new DB; this migration is only for a DB created before it existed
-- (including the local dev D1 instance most people already have running).
--
-- Run once against local dev:
--   cd worker && npx wrangler d1 execute jacob-gg-leaderboard --local --file=migrations/0001_add_is_late.sql
-- Run once against production, when ready to deploy this feature:
--   cd worker && npx wrangler d1 execute jacob-gg-leaderboard --remote --file=migrations/0001_add_is_late.sql

ALTER TABLE submissions ADD COLUMN is_late INTEGER NOT NULL DEFAULT 0;
