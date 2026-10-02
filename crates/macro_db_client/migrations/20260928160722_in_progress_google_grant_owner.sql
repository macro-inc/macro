-- Nullable for callbacks from authentication-service versions deployed before this migration.
ALTER TABLE in_progress_user_link ADD COLUMN google_grant_owner_id UUID;
