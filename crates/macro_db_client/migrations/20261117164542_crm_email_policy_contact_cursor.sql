-- Page raw mailbox contacts through the existing (link_id, email_address) index.
-- Keep the old thread cursor for rolling compatibility; no deployed worker uses it.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE crm_email_policy_work
    ADD COLUMN after_contact_address TEXT,
    ADD COLUMN received_pass BOOLEAN NOT NULL DEFAULT FALSE;
