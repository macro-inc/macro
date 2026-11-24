-- no-transaction
-- Existing indexes stay available to rolling binaries. If interrupted, inspect
-- pg_index.indisvalid and drop only this INVALID index before retrying.
-- Rollback: DROP INDEX CONCURRENTLY email_mailbox_commands_null_due;
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_mailbox_commands_null_due
    ON email_mailbox_commands ((CASE WHEN status IN ('pending','running') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END), id)
    WHERE (CASE WHEN status IN ('pending','running') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) < 'infinity'::timestamptz AND parked_at IS NULL AND provider IS NULL;
