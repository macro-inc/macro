CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE task_duplicate_embedding (
    document_id TEXT PRIMARY KEY REFERENCES "Document"(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX task_duplicate_embedding_vector_idx
    ON task_duplicate_embedding
    USING ivfflat (embedding vector_cosine_ops)
    -- IVFFlat lists should track roughly rows / 1000. lists = 100 is sized
    -- for about 100k task_duplicate_embedding rows; tune this index as task
    -- volume grows and query latency/recall data changes.
    WITH (lists = 100);

CREATE TABLE task_duplicate_match (
    id UUID PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES "Document"(id) ON DELETE CASCADE,
    duplicate_task_id TEXT NOT NULL REFERENCES "Document"(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    vector_score DOUBLE PRECISION NOT NULL,
    rerank_score DOUBLE PRECISION NOT NULL,
    judge_model TEXT,
    judge_reason TEXT,
    dismissed_by TEXT,
    dismissed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT task_duplicate_match_order CHECK (task_id < duplicate_task_id),
    CONSTRAINT task_duplicate_match_status CHECK (status IN ('active', 'dismissed'))
);

CREATE UNIQUE INDEX task_duplicate_match_pair_idx
    ON task_duplicate_match(task_id, duplicate_task_id);

CREATE INDEX task_duplicate_match_task_id_idx
    ON task_duplicate_match(task_id)
    WHERE status = 'active';

CREATE INDEX task_duplicate_match_duplicate_task_id_idx
    ON task_duplicate_match(duplicate_task_id)
    WHERE status = 'active';
