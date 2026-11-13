SET LOCAL lock_timeout = '5s';
ALTER TABLE email_sync_streams DROP COLUMN reader_revision;
