-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
-- Row comparisons on this prefix find work of a replaced grant or an expired
-- window as index ranges, which stay empty while nothing needs a reset.
CREATE INDEX CONCURRENTLY calendar_outlook_work_account_generation
    ON calendar_outlook_work (account_id, sync_generation, grant_generation, ends_at);
