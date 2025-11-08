-- Change user_id column from UUID to VARCHAR to match user ID format in the system
ALTER TABLE entity_mentions
ALTER COLUMN user_id TYPE VARCHAR;