-- Whether a routine's runs are listed in Home and the Agents list. Routines
-- that run often would bury the owner's own work, so runs start unlisted.
SET LOCAL lock_timeout = '5s';
ALTER TABLE scheduled_action
    ADD COLUMN IF NOT EXISTS run_visibility TEXT NOT NULL DEFAULT 'unlisted';
