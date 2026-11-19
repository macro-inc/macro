-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS calendar_outlook_work_account_due
    ON calendar_outlook_work (account_id, next_run_at, calendar_id NULLS FIRST);
