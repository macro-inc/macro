-- AI projections: optional model override and structured-output schema on the
-- projection definition. Both participate in the version hash (prompt_hash),
-- so changing either regenerates cached instances.
ALTER TABLE ai_projection
    ADD COLUMN model TEXT,
    ADD COLUMN output_schema JSONB;
