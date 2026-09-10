-- no-transaction
-- Superseded by idx_frecency_events_unprocessed_id (20260910144342), which
-- indexes the same rows on a column that can actually drive a scan.
-- Single statement: see 20260910144339 for the CONCURRENTLY constraint.
DROP INDEX CONCURRENTLY IF EXISTS idx_frecency_events_unprocessed;
