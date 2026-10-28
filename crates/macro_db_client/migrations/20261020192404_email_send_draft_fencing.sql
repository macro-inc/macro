SET lock_timeout = '5s';

-- Zero preserves existing clients. Admission and cancellation advance the
-- generation so requests captured before either boundary cannot edit the draft.
ALTER TABLE email_messages ADD COLUMN draft_generation integer NOT NULL DEFAULT 0;
