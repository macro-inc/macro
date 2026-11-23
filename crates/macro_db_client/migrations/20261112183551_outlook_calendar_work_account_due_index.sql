-- no-transaction
-- Keep this a single statement: SQLx batches would create an implicit transaction.
-- The Outlook claim reads each claimable account's first due row in claim order,
-- so work of disabled and reauth-required accounts is never walked.
CREATE INDEX CONCURRENTLY calendar_outlook_work_account_due
    ON calendar_outlook_work (account_id, next_run_at, calendar_id NULLS FIRST);
