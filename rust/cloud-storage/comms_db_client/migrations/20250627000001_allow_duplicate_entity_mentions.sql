-- Drop the composite primary key that prevents duplicates
ALTER TABLE entity_mentions
DROP CONSTRAINT entity_mentions_pkey;

-- Drop the unique index on id since we'll make it the primary key
DROP INDEX idx_entity_mentions_id;

-- Set the UUID id column as the new primary key
ALTER TABLE entity_mentions
ADD PRIMARY KEY (id);

-- Create a non-unique index for efficient querying by entity combination
CREATE INDEX idx_entity_mentions_combination 
    ON entity_mentions (source_entity_type, source_entity_id, entity_type, entity_id);