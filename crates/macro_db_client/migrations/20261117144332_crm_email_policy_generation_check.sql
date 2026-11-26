SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE crm_email_backfill_outbox VALIDATE CONSTRAINT crm_email_backfill_generation;
