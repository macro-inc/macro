SET LOCAL lock_timeout = '5s';

-- Nullable lease fields preserve older writers. The stable default is stored
-- as a missing value on existing rows, without rewriting the attempt table.
ALTER TABLE email_imap_connection_attempts
    ADD COLUMN lease_id UUID,
    ADD COLUMN lease_until TIMESTAMPTZ,
    ADD COLUMN recovery_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '2 minutes');
