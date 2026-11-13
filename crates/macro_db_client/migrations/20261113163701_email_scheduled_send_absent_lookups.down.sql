SET LOCAL lock_timeout = '2s';

ALTER TABLE email_scheduled_messages
    DROP COLUMN delivery_absent_lookups,
    DROP COLUMN delivery_resends;
