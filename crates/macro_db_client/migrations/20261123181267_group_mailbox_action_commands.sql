SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5s';

-- Old writers retain NULL and keep their single-command receipt.
ALTER TABLE email_mailbox_commands ADD COLUMN action_id UUID;
