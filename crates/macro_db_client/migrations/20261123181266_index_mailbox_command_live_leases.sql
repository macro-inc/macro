-- no-transaction
-- Draft exclusion probes only commands that currently hold a live lease.
-- Inspect and drop an interrupted INVALID index before retrying.
-- Rollback: DROP INDEX CONCURRENTLY email_mailbox_commands_live_lease;
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_mailbox_commands_live_lease
    ON email_mailbox_commands (link_id, generation, lease_until, id)
    WHERE lease_id IS NOT NULL AND status IN ('pending','running','confirming');
