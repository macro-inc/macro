-- Sequences that skip weekends; existing ones start doing so.
SET LOCAL lock_timeout = '5s';

ALTER TABLE email_sequences ADD COLUMN weekdays_only boolean NOT NULL DEFAULT true;
