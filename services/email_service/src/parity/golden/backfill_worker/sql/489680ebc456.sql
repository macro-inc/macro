UPDATE email_backfill_completion_outbox SET effects_lease_token = NULL, effects_lease_expires_at = NULL WHERE backfill_job_id = $1 AND completed_at IS NULL AND effects_lease_token = $2
