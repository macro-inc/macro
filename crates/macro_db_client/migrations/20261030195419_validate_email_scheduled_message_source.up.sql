-- Run after the previous migration releases its exclusive table lock.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_scheduled_messages VALIDATE CONSTRAINT email_scheduled_messages_source_check;
