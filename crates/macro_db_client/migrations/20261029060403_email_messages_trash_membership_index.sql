-- no-transaction
-- Folder candidate selection must not scan every message in an inbox.
CREATE INDEX CONCURRENTLY email_messages_trash_membership
ON email_messages (link_id, id)
WHERE mailbox_state @> '{"in_trash":true}'::jsonb;
