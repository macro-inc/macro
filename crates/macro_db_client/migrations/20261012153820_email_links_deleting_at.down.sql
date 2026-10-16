SET LOCAL lock_timeout = '5s';

ALTER TABLE email_links DROP COLUMN deleting_at;
