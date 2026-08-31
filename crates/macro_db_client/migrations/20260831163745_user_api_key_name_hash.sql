-- Persist only SHA-256(secret) like bot_tokens, plus a user-facing name.
-- Address rows by UUIDv7 `id`. Drop the plaintext `key` column.
ALTER TABLE "UserApiKey"
    ADD COLUMN name TEXT,
    ADD COLUMN hash BYTEA;

UPDATE "UserApiKey"
SET
    name = COALESCE(NULLIF(prefix, ''), 'Unnamed'),
    hash = digest(convert_to(key, 'UTF8'), 'sha256')
WHERE name IS NULL
   OR hash IS NULL;

ALTER TABLE "UserApiKey"
    ALTER COLUMN name SET NOT NULL,
    ALTER COLUMN hash SET NOT NULL;

ALTER TABLE "UserApiKey" DROP CONSTRAINT "UserApiKey_pkey";

DROP INDEX IF EXISTS "UserApiKey_key_key";
DROP INDEX IF EXISTS "UserApiKey_key_idx";

ALTER TABLE "UserApiKey"
    DROP COLUMN key,
    DROP COLUMN prefix,
    DROP COLUMN created_at;

ALTER TABLE "UserApiKey" ADD CONSTRAINT "UserApiKey_pkey" PRIMARY KEY (id);

DROP INDEX IF EXISTS "UserApiKey_id_key";

CREATE UNIQUE INDEX "UserApiKey_hash_key" ON "UserApiKey" (hash);
