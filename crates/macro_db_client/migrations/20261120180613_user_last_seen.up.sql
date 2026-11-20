-- The foreign key briefly locks "User" against writes; fail fast rather than
-- queue its writers behind a long transaction.
SET LOCAL lock_timeout = '3s';

-- When each person last had a signed-in Macro client open. The connection
-- gateway writes it when a client connects and every hour it stays
-- connected; the activity check (crates/activity, UserActivity) reads it
-- beside activity_events, so per-user background jobs can pass over people
-- who are away. One row per user, updated in place: seen_at is not indexed
-- and each page keeps a fifth free, so an update stays a heap-only tuple and
-- never touches the key index.
CREATE TABLE user_last_seen (
    user_id TEXT PRIMARY KEY REFERENCES "User" (id) ON DELETE CASCADE,
    seen_at TIMESTAMPTZ NOT NULL
) WITH (fillfactor = 80);
