INSERT INTO email_backfill_init_outbox (id, backfill_job_id) VALUES ($1, $2) ON CONFLICT (backfill_job_id) DO NOTHING
