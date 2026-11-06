-- no-transaction
-- Serves attachments_by_thread_ids (email preview hydration):
--   WHERE thread_id = ANY($1) ORDER BY created_at
-- Before email_attachments.thread_id existed the query joined every message of
-- every thread to probe idx_email_attachments_message_id once per message.
-- Single statement: see 20260910144339 for the CONCURRENTLY constraint.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_attachments_thread_id_created_at
    ON email_attachments (thread_id, created_at);
