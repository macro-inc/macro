-- Tracks ai projection instances that are currently being materialized.
-- A row exists only while a worker is actively processing the
-- (ai_projection_id, target_id) pair; it is deleted when processing finishes
-- (on success or failure). The composite primary key prevents two workers from
-- materializing the same instance concurrently, and `created_at` lets us reclaim
-- rows left behind by crashed/stuck workers.
CREATE TABLE processing_ai_projections (
    ai_projection_id TEXT        NOT NULL REFERENCES ai_projection (id) ON DELETE CASCADE,
    target_id        TEXT        NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT processing_ai_projections_pkey PRIMARY KEY (ai_projection_id, target_id)
);

-- Supports stale-row cleanup by age.
CREATE INDEX processing_ai_projections_created_at_idx
    ON processing_ai_projections (created_at);
