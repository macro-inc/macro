UPDATE email_backfill_jobs SET status = $1::email_backfill_job_status, updated_at = now() WHERE id = $2
