-- no-transaction
-- Replaces idx_frecency_events_unprocessed, which keys on was_processed under
-- the predicate `was_processed = false`. Every entry in that index therefore
-- holds the same key value, so it offers neither ordering nor selectivity and
-- the planner never chose it -- Datadog reported it as unused.
-- The poller claims batches with `ORDER BY id ... FOR UPDATE SKIP LOCKED`, so
-- keying on id under the same predicate gives that scan something to walk.
-- Added before the old index is dropped (20260910144343) so no deploy window
-- runs without one.
-- Single statement: see 20260910144339 for the CONCURRENTLY constraint.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_frecency_events_unprocessed_id
    ON frecency_events (id) WHERE was_processed = false;
