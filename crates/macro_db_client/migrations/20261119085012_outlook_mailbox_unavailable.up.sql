-- When folder discovery found that Graph serves no mailbox for an Outlook
-- link (a 404 to its Inbox), or NULL. Sync skips a marked link until a
-- discovery finds the mailbox or the account reconnects. A nullable column
-- without a default is a catalog-only change.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_links ADD COLUMN mailbox_unavailable_at TIMESTAMPTZ;
