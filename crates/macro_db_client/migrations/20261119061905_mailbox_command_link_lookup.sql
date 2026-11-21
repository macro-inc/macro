-- no-transaction
-- Bound reconnect updates and command ordering to this mailbox generation.
-- If interrupted, drop an INVALID index before rerunning this migration.
CREATE INDEX CONCURRENTLY email_mailbox_commands_active_link_order
    ON email_mailbox_commands(link_id, generation, accepted_order)
    INCLUDE (id)
    WHERE status IN ('pending','running','confirming');
