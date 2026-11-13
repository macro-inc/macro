-- no-transaction
-- Live webhooks' filters, for ingestion's "does any webhook name this event"
-- probe (any_webhook_names): paused, invalid and deleted webhooks must not
-- make a miss look like a likely hit and push the probe onto a seq scan.
-- Keep this a single statement: SQLx batches would create an implicit transaction.
CREATE INDEX CONCURRENTLY webhook_filters_live_gin_idx
    ON webhook USING gin (filters jsonb_path_ops)
    WHERE deleted_at IS NULL AND status = 'active' AND is_valid;
