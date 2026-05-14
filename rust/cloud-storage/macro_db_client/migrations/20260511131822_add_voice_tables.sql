CREATE TABLE IF NOT EXISTS voice (
    id         UUID PRIMARY KEY,
    embedding  vector(256) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_embedding_cosine
    ON voice USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS macro_user_voice (
    macro_user_id UUID NOT NULL REFERENCES macro_user(id) ON DELETE CASCADE,
    voice_id      UUID NOT NULL REFERENCES voice(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (macro_user_id, voice_id)
);

CREATE INDEX IF NOT EXISTS idx_macro_user_voice_voice_id
    ON macro_user_voice (voice_id);
