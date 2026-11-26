SET LOCAL lock_timeout = '5s';

ALTER TABLE email_thread_focus
    DROP COLUMN IF EXISTS due_at,
    DROP COLUMN IF EXISTS event_over_at,
    DROP COLUMN IF EXISTS dates_classified_at;
