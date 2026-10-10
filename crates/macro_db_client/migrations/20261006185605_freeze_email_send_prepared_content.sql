-- Keep the original request untouched for idempotency. Older writers may omit
-- prepared content; new delivery workers pause those attempts for user review
-- rather than backfilling from message rows that provider sync may have changed.
ALTER TABLE email_send_attempts ADD COLUMN prepared_content JSONB;
