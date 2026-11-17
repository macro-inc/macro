-- The calendar day a Focus thread is due, when its mail names an open deadline.
-- A date, so no time zone can shift what the row shows. Nullable: existing rows
-- have none until new mail is classified, and old writers leave it alone.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_thread_focus
    ADD COLUMN due_on DATE;
