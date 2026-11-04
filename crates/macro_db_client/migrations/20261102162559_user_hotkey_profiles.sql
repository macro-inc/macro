-- The keyboard shortcut layout each user picked per area of the app. NULL is
-- Macro's own layout; a missing row is Macro's layout everywhere. Values are
-- validated in Rust (`crates/user_hotkey_profiles`), so a new layout needs no
-- migration.
CREATE TABLE user_hotkey_profiles (
    user_id TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
    email_profile TEXT,
    tasks_profile TEXT,
    modified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
