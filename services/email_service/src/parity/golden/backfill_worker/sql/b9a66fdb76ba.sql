UPDATE email_backfill_jobs SET init_lease_token = NULL, init_lease_expires_at = NULL, updated_at = now() WHERE id = $1 AND status = 'Init' AND init_lease_token = $2
