-- no-transaction
-- Supports keyset pagination over call_records for the search backfill
-- orchestrator, which sorts by (started_at ASC, id ASC). call_records
-- doesn't have an updated_at column so the cursor uses started_at —
-- functionally equivalent for these calls since they're immutable
-- after creation.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_call_records_started_at_id
    ON call_records (started_at, id);
