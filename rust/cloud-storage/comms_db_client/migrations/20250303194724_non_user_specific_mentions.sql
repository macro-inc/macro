ALTER TABLE message_mentions 
ADD COLUMN entity_type VARCHAR(32),
ADD COLUMN entity_id VARCHAR;

UPDATE message_mentions
SET entity_type = 'user',
    entity_id = user_id;

ALTER TABLE message_mentions 
ALTER COLUMN entity_type SET NOT NULL,
ALTER COLUMN entity_id SET NOT NULL;

ALTER TABLE message_mentions
DROP COLUMN user_id;
