-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
CREATE INDEX CONCURRENTLY calendar_projection_outbox_due
    ON calendar_projection_outbox (next_run_at);
