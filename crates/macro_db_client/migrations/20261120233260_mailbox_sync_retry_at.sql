-- Optional retry guidance; old writers and readers ignore it.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_links ADD COLUMN mailbox_retry_at TIMESTAMPTZ;
