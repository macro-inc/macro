-- no-transaction
-- Completed receipts stay out of this finite-deadline claim index.
-- If interrupted, inspect pg_index.indisvalid and drop only the INVALID index
-- concurrently before retrying: IF NOT EXISTS cannot repair an invalid build.
-- Rollback: DROP INDEX CONCURRENTLY email_imap_connection_attempts_due;
-- then restore the old created_at index concurrently before older recovery runs.
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_imap_connection_attempts_due
    ON email_imap_connection_attempts (
        (CASE WHEN completed THEN 'infinity'::timestamptz
            ELSE GREATEST(recovery_at, COALESCE(lease_until, '-infinity'::timestamptz))
        END), id
    ) WHERE (CASE WHEN completed THEN 'infinity'::timestamptz
        ELSE GREATEST(recovery_at, COALESCE(lease_until, '-infinity'::timestamptz))
    END) < 'infinity'::timestamptz;
