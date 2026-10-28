-- no-transaction
-- Billing sums only counted usage. Keep the full ai_usage_user_id_created_at_idx
-- for admin analytics and older deployed services that also read uncounted rows.
-- Before retrying an interrupted build, check validity and definition:
-- SELECT indisvalid, pg_get_indexdef(indexrelid)
-- FROM pg_index
-- WHERE indexrelid = to_regclass('ai_usage_counted_user_created_at_idx');
-- IF NOT EXISTS does not repair an INVALID index. If present but invalid, run
-- DROP INDEX CONCURRENTLY ai_usage_counted_user_created_at_idx;
-- outside a transaction before retrying this migration. If valid, verify that
-- its definition matches the index below before allowing the retry to skip it.
CREATE INDEX CONCURRENTLY IF NOT EXISTS ai_usage_counted_user_created_at_idx
    ON ai_usage (user_id, created_at DESC)
    WHERE count_usage = TRUE;
