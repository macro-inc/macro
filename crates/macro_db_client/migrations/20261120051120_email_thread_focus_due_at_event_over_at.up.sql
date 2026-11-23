-- When a Focus thread's due day begins for its owner, so a thread they wrote last
-- on comes back that day, and when the day of the meeting its mail is about is
-- over for them, so it leaves Focus. Instants, computed in the owner's calendar
-- zone when the mail is classified, since the read has no zone of its own.
-- dates_classified_at is the classified_at of the write that stored them: a
-- writer from before these columns sets classified_at and leaves them as they
-- were, and reads count them only while the two are still equal.
-- Nullable: existing rows have none until new mail is classified.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_thread_focus
    ADD COLUMN due_at TIMESTAMPTZ,
    ADD COLUMN event_over_at TIMESTAMPTZ,
    ADD COLUMN dates_classified_at TIMESTAMPTZ;
