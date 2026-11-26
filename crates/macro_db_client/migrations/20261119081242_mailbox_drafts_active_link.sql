-- no-transaction
-- Reconnect rebinds unfinished drafts even before they have a provider draft id.
-- If interrupted, drop an INVALID index before rerunning this migration.
CREATE INDEX CONCURRENTLY email_mailbox_drafts_active_link
    ON email_mailbox_drafts(link_id)
    WHERE state NOT IN ('sent','deleted');
