-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
-- Every stream claim filters on kind and orders by (next_run_at, id), so leading
-- with kind keeps a claim from reading the due rows of other kinds.
CREATE INDEX CONCURRENTLY email_sync_streams_claim
    ON email_sync_streams (kind, next_run_at, id);
