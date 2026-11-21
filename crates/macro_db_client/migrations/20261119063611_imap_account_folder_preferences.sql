SET LOCAL lock_timeout = '5s';

-- Constant defaults are metadata-only. Older accounts begin with automatic folder mapping.
ALTER TABLE imap_accounts
    ADD COLUMN folder_preferences_revision BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN folder_role_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN excluded_folder_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN watched_folder_ids JSONB NOT NULL DEFAULT '[]'::jsonb;
