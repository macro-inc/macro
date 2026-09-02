-- User API keys: opaque UUIDv7 id, user-facing name, SHA-256 hash, created_at.
-- New rows get id from application code (CS-01). Existing rows are backfilled
-- from the legacy plaintext `key` column, which is then dropped.
ALTER TABLE "UserApiKey"
    ADD COLUMN id UUID,
    ADD COLUMN name TEXT,
    ADD COLUMN hash BYTEA,
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE "UserApiKey"
SET
    id = encode(
        substring(digest(convert_to(key, 'UTF8'), 'sha256') FROM 1 FOR 16),
        'hex'
    )::uuid,
    name = 'Unnamed',
    hash = digest(convert_to(key, 'UTF8'), 'sha256')
WHERE id IS NULL
   OR name IS NULL
   OR hash IS NULL;

ALTER TABLE "UserApiKey"
    ALTER COLUMN id SET NOT NULL,
    ALTER COLUMN name SET NOT NULL,
    ALTER COLUMN hash SET NOT NULL;

ALTER TABLE "UserApiKey" DROP CONSTRAINT "UserApiKey_pkey";

DROP INDEX IF EXISTS "UserApiKey_key_key";
DROP INDEX IF EXISTS "UserApiKey_key_idx";

ALTER TABLE "UserApiKey"
    DROP COLUMN key;

ALTER TABLE "UserApiKey" ADD CONSTRAINT "UserApiKey_pkey" PRIMARY KEY (id);

CREATE UNIQUE INDEX "UserApiKey_hash_key" ON "UserApiKey" (hash);

-- List filters by user_id and orders by created_at DESC, id DESC. Count
-- filters by user_id. This composite covers both; the old user_id-only
-- index is redundant.
DROP INDEX IF EXISTS "UserApiKey_user_id_idx";
CREATE INDEX "UserApiKey_user_id_created_at_id_idx"
    ON "UserApiKey" (user_id, created_at DESC, id DESC);
