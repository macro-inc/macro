UPDATE email_backfill_jobs SET threads_retrieved_count = threads_retrieved_count + $1, updated_at = now() WHERE id = $2
