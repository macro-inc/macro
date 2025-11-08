-- Add UUID id column to entity_mentions table
ALTER TABLE entity_mentions
ADD COLUMN id UUID DEFAULT gen_random_uuid() NOT NULL;

-- Create unique index on id
CREATE UNIQUE INDEX idx_entity_mentions_id ON entity_mentions (id);
