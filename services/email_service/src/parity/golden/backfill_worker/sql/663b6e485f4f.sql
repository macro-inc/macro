UPDATE email_backfill_jobs SET total_threads = $1, updated_at = now() WHERE id = $2
