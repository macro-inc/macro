-- no-transaction
-- Unsent sequence steps: the send-slot read (latest per inbox) and the sweep
-- that withdraws steps whose enrollment is gone.
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_scheduled_messages_pending_sequence_idx
    ON email_scheduled_messages (link_id, send_time)
    WHERE source IS NOT NULL AND NOT sent;
