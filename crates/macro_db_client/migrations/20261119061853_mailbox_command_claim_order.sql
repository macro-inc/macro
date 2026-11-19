-- no-transaction
-- Claim order includes id so equal due times can stop at one indexed row.
-- If interrupted, drop an INVALID index before rerunning this migration.
CREATE INDEX CONCURRENTLY email_mailbox_commands_ready_order
    ON email_mailbox_commands(available_at, id)
    WHERE status IN ('pending','running');
