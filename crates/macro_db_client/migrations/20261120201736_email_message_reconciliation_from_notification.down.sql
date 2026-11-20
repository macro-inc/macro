SET LOCAL lock_timeout = '5s';
ALTER TABLE email_message_reconciliation
    DROP COLUMN from_notification;
