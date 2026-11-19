-- Consecutive failed upkeep runs of a mailbox's Graph subscription, so a
-- subscription Graph keeps refusing backs off. One row per Outlook link; a
-- constant default is a catalog-only change.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_mailbox_watch_work ADD COLUMN failures INTEGER NOT NULL DEFAULT 0;
