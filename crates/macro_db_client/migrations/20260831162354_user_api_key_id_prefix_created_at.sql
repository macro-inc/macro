-- Opaque addressing for user API keys: list/delete must not use the secret.
-- Existing rows get a deterministic UUID from sha256(key); new rows are
-- assigned UUIDv7 in application code (CS-01).
ALTER TABLE "UserApiKey"
    ADD COLUMN id UUID,
    ADD COLUMN prefix TEXT,
    ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE "UserApiKey"
SET
    id = encode(
        substring(digest(convert_to(key, 'UTF8'), 'sha256') FROM 1 FOR 16),
        'hex'
    )::uuid,
    prefix = 'mak_' || left(
        encode(digest(convert_to(key, 'UTF8'), 'sha256'), 'hex'),
        8
    )
WHERE id IS NULL
   OR prefix IS NULL;

ALTER TABLE "UserApiKey"
    ALTER COLUMN id SET NOT NULL,
    ALTER COLUMN prefix SET NOT NULL;

CREATE UNIQUE INDEX "UserApiKey_id_key" ON "UserApiKey" (id);
