-- Who created a scheduled send. NULL is an ordinary send from the composer,
-- SDK or agents; 'sequence' is a step of an email sequence, which stays out of
-- the user's Drafts and Scheduled lists until it is sent or fails. Nullable, so
-- workers deployed before this column keep writing ordinary schedules.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_scheduled_messages
    ADD COLUMN source TEXT,
    ADD CONSTRAINT email_scheduled_messages_source_check
        CHECK (source IN ('sequence')) NOT VALID;
