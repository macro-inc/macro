-- How fast a thread's importance moves once its classified message sits
-- untouched, as a signed percent of the remaining distance per day: positive
-- moves towards 100, negative towards 0. The list applies it when it reads.
-- Existing rows read 0, flat, until their next message is classified.
-- A constant default only changes the catalog, so old writers keep working.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_thread_focus
    ADD COLUMN importance_rate SMALLINT NOT NULL DEFAULT 0;
