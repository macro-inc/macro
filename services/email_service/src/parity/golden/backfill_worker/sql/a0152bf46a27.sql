UPDATE email_backfill_jobs SET status = 'Failed', updated_at = now() WHERE id = $1 AND status IN ('Init', 'InProgress')
