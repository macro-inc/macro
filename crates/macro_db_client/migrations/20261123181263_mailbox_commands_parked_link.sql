-- no-transaction
-- Bounded shared-sweep discovery and per-link recovery use this same range.
-- Inspect and drop an interrupted INVALID index before retrying.
-- Rollback: DROP INDEX CONCURRENTLY email_mailbox_commands_parked_link;
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_mailbox_commands_parked_link
    ON email_mailbox_commands (link_id, generation, id)
    WHERE parked_at IS NOT NULL;
