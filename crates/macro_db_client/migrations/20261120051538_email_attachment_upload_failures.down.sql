SET LOCAL lock_timeout = '5s';

ALTER TABLE email_attachments
    DROP COLUMN upload_abandoned_at,
    DROP COLUMN upload_failures;
