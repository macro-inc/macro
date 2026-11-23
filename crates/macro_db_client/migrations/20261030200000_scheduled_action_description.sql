-- What a routine is for, in its owner's words. Empty for routines that have none.
SET LOCAL lock_timeout = '5s';
ALTER TABLE scheduled_action
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
