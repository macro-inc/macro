-- Every row predates `provider_api_key_id` and is NULL, so this only confirms
-- the constraint. VALIDATE takes a lock that still allows inserts, unlike the
-- one adding the constraint, which is why the two are separate migrations.
SET LOCAL lock_timeout = '5s';
ALTER TABLE ai_usage VALIDATE CONSTRAINT ai_usage_provider_api_key_id_fkey;
