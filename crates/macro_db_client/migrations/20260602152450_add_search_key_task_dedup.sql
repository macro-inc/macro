-- Support multiple embeddings per task (one per "part", identified by search_key).
-- Wipe existing rows: the old table held a single whole-task embedding per
-- document, which is incompatible with the new per-part model. The pipeline
-- re-embeds everything after this migration.
TRUNCATE TABLE task_duplicate_embedding;

-- Duplicate detection only ever uses one embedding model, so the per-row model
-- column is dead weight; drop it.
ALTER TABLE task_duplicate_embedding
    DROP COLUMN model;

ALTER TABLE task_duplicate_embedding
    ADD COLUMN search_key TEXT NOT NULL;

-- Replace the single-column primary key (document_id) with a composite key so a
-- task can have one row per search_key.
ALTER TABLE task_duplicate_embedding
    DROP CONSTRAINT task_duplicate_embedding_pkey,
    ADD PRIMARY KEY (document_id, search_key);

-- Supports vector queries filtered by part, e.g.
--   WHERE search_key = $1 ORDER BY embedding <=> $2
CREATE INDEX task_duplicate_embedding_search_key
    ON task_duplicate_embedding
    USING btree (search_key);

-- Swap the IVFFlat vector index (created in 20260528120000) for HNSW. HNSW pairs
-- better with pgvector 0.8 iterative index scans for filtered queries
-- (WHERE search_key = ...): the scan keeps pulling candidates from the index
-- until enough rows pass the filter, preserving recall without a per-search_key
-- partial index. HNSW also needs no size-based retuning as IVFFlat's `lists`
-- does. Cheap to build here because the table was just truncated.
--
-- Enable iterative scans at query time (off by default), e.g. per transaction:
--   SET LOCAL hnsw.iterative_scan = relaxed_order;
DROP INDEX IF EXISTS task_duplicate_embedding_vector_idx;

CREATE INDEX task_duplicate_embedding_vector_idx
    ON task_duplicate_embedding
    USING hnsw (embedding vector_cosine_ops);
