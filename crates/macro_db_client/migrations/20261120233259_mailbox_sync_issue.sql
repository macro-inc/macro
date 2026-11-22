-- Additive health projection; old writers/readers ignore the nullable column.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_links ADD COLUMN mailbox_issue TEXT;
