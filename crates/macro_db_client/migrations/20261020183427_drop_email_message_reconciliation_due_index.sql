-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
DROP INDEX CONCURRENTLY IF EXISTS email_message_reconciliation_due;
