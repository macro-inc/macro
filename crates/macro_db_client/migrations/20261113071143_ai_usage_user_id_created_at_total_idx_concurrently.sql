-- no-transaction
-- Per-user sums of `total` over a period (an agent's spend by day, week,
-- month or year; per-user AI analytics) read every row in the range. With
-- `total` in the index they are index-only scans instead of one heap page per
-- row. Same keys as ai_usage_user_id_created_at_idx, which the next migration
-- drops. Built CONCURRENTLY so completions keep writing. IF NOT EXISTS does
-- not repair an INVALID index left by an interrupted build: check
-- `SELECT indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('ai_usage_user_id_created_at_total_idx')`, and if false run
-- `DROP INDEX CONCURRENTLY ai_usage_user_id_created_at_total_idx` before
-- retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_usage_user_id_created_at_total_idx
    ON ai_usage (user_id, created_at DESC)
    INCLUDE (total);
