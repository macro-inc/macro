-- Add optional user_id field to entity_mentions table
ALTER TABLE entity_mentions
ADD COLUMN user_id UUID;

-- Create index on user_id for efficient querying
CREATE INDEX idx_entity_mentions_user_id 
    ON entity_mentions (user_id) 
    WHERE user_id IS NOT NULL;