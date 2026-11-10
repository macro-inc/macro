UPDATE email_backfill_completion_outbox SET completed_at = now() WHERE backfill_job_id = $1 AND completed_at IS NULL AND effects_lease_token = $2 AND effects_lease_expires_at > now()
