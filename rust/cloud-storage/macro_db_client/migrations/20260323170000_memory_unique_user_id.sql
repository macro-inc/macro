-- One memory per user; upsert overwrites on new generation.
DROP INDEX memory_user_id_idx;
DROP INDEX memory_user_id_created_at_idx;
ALTER TABLE memory ADD CONSTRAINT memory_user_id_unique UNIQUE (user_id);
