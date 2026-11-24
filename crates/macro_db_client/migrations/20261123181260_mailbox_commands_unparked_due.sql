-- no-transaction
-- Existing indexes stay available to rolling binaries. If interrupted, inspect
-- pg_index.indisvalid and drop only this INVALID index before retrying.
-- Rollback: DROP INDEX CONCURRENTLY email_mailbox_commands_unparked_due;
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_mailbox_commands_unparked_due
    ON email_mailbox_commands (provider, (CASE WHEN status IN ('pending','running') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END), id)
    WHERE (CASE WHEN status IN ('pending','running') THEN GREATEST(available_at, COALESCE(lease_until, '-infinity'::timestamptz), COALESCE(blocked_until, '-infinity'::timestamptz)) ELSE 'infinity'::timestamptz END) < 'infinity'::timestamptz AND parked_at IS NULL AND provider IS NOT NULL;
