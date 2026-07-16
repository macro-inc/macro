-- no-transaction

-- Latest-backfill-job-per-link lookup (links list sync status).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_backfill_jobs_link_id_created_at
    ON email_backfill_jobs (link_id, created_at DESC);
