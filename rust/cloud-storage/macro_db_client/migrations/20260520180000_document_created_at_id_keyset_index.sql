-- no-transaction
-- Supports keyset (seek-method) pagination over Document for the search
-- backfill orchestrator. The pre-existing query sorts by
-- ("createdAt" ASC, id ASC); offset-based pagination scaled linearly with
-- depth and tripped the read-replica's max_standby_streaming_delay budget
-- ~250k rows in, killing the orchestrator with a "canceling statement due
-- to conflict with recovery" error. With this index, each keyset page is
-- an O(log n) b-tree seek to the cursor position followed by a forward
-- walk of `LIMIT` entries — query duration stays constant regardless of
-- depth.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_document_created_at_id
    ON "Document" ("createdAt", id);
