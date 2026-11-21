SET LOCAL lock_timeout = '5s';
ALTER TABLE email_message_reconciliation
    DROP COLUMN unfinished_claims,
    DROP COLUMN claimed_revision;
