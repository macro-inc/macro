-- no-transaction
-- Finds a routine's webhook delivery by the sender's Idempotency-Key, so a
-- repeat within a day answers with the first delivery's run. Partial: only
-- webhook deliveries that sent a key. Built CONCURRENTLY so event runs keep
-- being admitted. IF NOT EXISTS does not repair an INVALID index left by an
-- interrupted build: check `SELECT indisvalid FROM pg_index WHERE indexrelid =
-- to_regclass('scheduled_action_event_run_webhook_key_idx')`, and if false run
-- `DROP INDEX CONCURRENTLY scheduled_action_event_run_webhook_key_idx` before
-- retrying.
CREATE INDEX CONCURRENTLY IF NOT EXISTS scheduled_action_event_run_webhook_key_idx
    ON scheduled_action_event_run (action_id, (event_context #>> '{webhook,idempotency_key}'), admitted_at)
    WHERE event_context #>> '{webhook,idempotency_key}' IS NOT NULL;
