-- no-transaction
-- Each provider scheduler reads only the oldest due projection per mailbox.
-- If interrupted, drop an INVALID index before rerunning this migration.
CREATE INDEX CONCURRENTLY email_projection_outbox_link_due_order
    ON email_projection_outbox(link_id, available_at, id);
