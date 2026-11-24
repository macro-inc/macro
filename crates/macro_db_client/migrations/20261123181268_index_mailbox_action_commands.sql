-- no-transaction
-- A grouped receipt reads only its own chunks, including retained terminal ones.
-- Inspect and drop an interrupted INVALID index before retrying.
-- Rollback: DROP INDEX CONCURRENTLY email_mailbox_commands_action;
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_mailbox_commands_action
    ON email_mailbox_commands (link_id, action_id)
    WHERE action_id IS NOT NULL;
