SELECT completed_at IS NULL AS "pending!" FROM email_backfill_completion_outbox WHERE backfill_job_id = $1
