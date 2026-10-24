-- The judge scores 0 to 100 (shared/clues.js scoreFrom) instead of a
-- three-way verdict. The verdict column stays as a coarse bucket for the log;
-- the score is what is served and stored on submissions. Rows without a
-- score (judged under prompt v1) are re-judged on their next request.
--
--   cd worker && npx wrangler d1 execute jacob-gg-leaderboard --local --file=migrations/0003_judge_score.sql
--   cd worker && npx wrangler d1 execute jacob-gg-leaderboard --remote --file=migrations/0003_judge_score.sql

ALTER TABLE judge_verdicts ADD COLUMN score REAL;
ALTER TABLE judge_verdicts ADD COLUMN override_score REAL;
