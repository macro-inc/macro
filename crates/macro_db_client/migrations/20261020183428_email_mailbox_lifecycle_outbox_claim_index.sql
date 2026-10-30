-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
-- Columns follow the ORDER BY of the lifecycle claim so it reads the first due row.
CREATE INDEX CONCURRENTLY email_mailbox_lifecycle_outbox_claim
    ON email_mailbox_lifecycle_outbox (((payload->>'kind') = 'gmail_history'), available_at, id);
