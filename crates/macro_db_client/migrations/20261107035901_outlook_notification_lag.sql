-- When the Graph change notification that queued this message arrived, so
-- its import can report the notification-to-import lag. NULL for messages
-- queued by polling or an initial import. Adding a nullable column without a
-- default rewrites no rows; the short lock timeout keeps the sync workers'
-- claims from queueing behind it on this busy table.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_message_reconciliation ADD COLUMN notified_at TIMESTAMPTZ;
