-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
-- Columns follow the ORDER BY of the reconciliation claim so it reads the first due row.
CREATE INDEX CONCURRENTLY email_message_reconciliation_claim
    ON email_message_reconciliation (is_import, available_at, link_id, provider_id);
