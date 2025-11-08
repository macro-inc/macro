-- Rename message_mentions table to entity_mentions
ALTER TABLE message_mentions RENAME TO entity_mentions;

-- Add source_entity_type and source_entity_id columns
ALTER TABLE entity_mentions 
ADD COLUMN source_entity_type VARCHAR(32),
ADD COLUMN source_entity_id VARCHAR;

-- Populate source columns from existing message_id
UPDATE entity_mentions
SET source_entity_type = 'message',
    source_entity_id = message_id::TEXT;

-- Make new columns NOT NULL
ALTER TABLE entity_mentions 
ALTER COLUMN source_entity_type SET NOT NULL,
ALTER COLUMN source_entity_id SET NOT NULL;

-- Drop the old message_id column
ALTER TABLE entity_mentions
DROP COLUMN message_id;

-- Drop the old primary key
ALTER TABLE entity_mentions
DROP CONSTRAINT IF EXISTS message_mentions_pkey;

-- Remove any duplicate rows before creating the primary key
DELETE FROM entity_mentions a
USING entity_mentions b
WHERE a.ctid < b.ctid
  AND a.source_entity_type = b.source_entity_type
  AND a.source_entity_id = b.source_entity_id
  AND a.entity_type = b.entity_type
  AND a.entity_id = b.entity_id;

-- Create new composite primary key
ALTER TABLE entity_mentions
ADD PRIMARY KEY (source_entity_type, source_entity_id, entity_type, entity_id);

-- Drop old indexes that reference message_id
DROP INDEX IF EXISTS idx_message_mentions_entity_type_id;

-- Create new indexes for efficient querying
CREATE INDEX idx_entity_mentions_entity_type_id 
    ON entity_mentions (entity_type, entity_id)
    INCLUDE (source_entity_type, source_entity_id);

CREATE INDEX idx_entity_mentions_source 
    ON entity_mentions (source_entity_type, source_entity_id);

-- Add index for created_at for ordering
CREATE INDEX idx_entity_mentions_created_at 
    ON entity_mentions (created_at DESC);
