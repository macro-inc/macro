-- no-transaction
-- Build the replacement mapping index without blocking existing job writers.
CREATE UNIQUE INDEX CONCURRENTLY email_backfill_jobs_recovery_of_key
    ON email_backfill_jobs (recovery_of) WHERE recovery_of IS NOT NULL;
