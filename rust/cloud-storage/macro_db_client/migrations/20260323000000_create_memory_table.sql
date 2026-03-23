CREATE TABLE memory (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    memory TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX memory_user_id_idx ON memory (user_id);
CREATE INDEX memory_user_id_created_at_idx ON memory (user_id, created_at DESC);
