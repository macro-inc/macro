-- One encrypted credential + device-attempt payload per Macro user.
-- Row locks serialize provider refresh/exchange across replicas. Keeping the row on
-- disconnect preserves the lock identity; only the ciphertext is cleared.
CREATE TABLE codex_connections (
    user_id TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
    encrypted_state JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT codex_connections_envelope_object CHECK (
        encrypted_state IS NULL OR jsonb_typeof(encrypted_state) = 'object'
    )
);
