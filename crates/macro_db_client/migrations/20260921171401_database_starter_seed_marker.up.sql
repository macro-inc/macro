-- Retain the user's completed attempt after a database is deleted, so opening
-- the app never recreates content they intentionally removed.
CREATE TABLE database_starter_seeds (
    user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    database_id UUID REFERENCES databases(id) ON DELETE SET NULL
);
