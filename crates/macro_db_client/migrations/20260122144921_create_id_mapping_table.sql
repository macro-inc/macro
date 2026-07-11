-- Create a simple key-value table for storing ID mappings
-- Used for mapping tool IDs to document IDs (e.g., code execution files)

CREATE TABLE id_mapping
(
    source_id  TEXT         NOT NULL,
    target_id  TEXT         NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT id_mapping_pkey PRIMARY KEY (source_id)
);

-- Index for looking up by target ID if needed
CREATE INDEX id_mapping_target_id_idx ON id_mapping (target_id);
