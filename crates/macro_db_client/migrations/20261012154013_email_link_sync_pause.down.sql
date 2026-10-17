SET LOCAL lock_timeout = '5s';

ALTER TABLE email_links
    DROP COLUMN last_active_at,
    DROP COLUMN sync_paused_at;
