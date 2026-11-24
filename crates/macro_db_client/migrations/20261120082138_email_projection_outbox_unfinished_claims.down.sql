SET LOCAL lock_timeout = '5s';
ALTER TABLE email_projection_outbox
    DROP COLUMN unfinished_claims;
