-- no-transaction
-- email_sync_streams_claim (kind, next_run_at, id) serves every query that used
-- this index. Single statement on purpose: see
-- 20261111230603_email_sync_streams_claim_index.sql.
DROP INDEX CONCURRENTLY IF EXISTS email_sync_streams_due;
