-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS calendar_outlook_work_due ON calendar_outlook_work (next_run_at);
