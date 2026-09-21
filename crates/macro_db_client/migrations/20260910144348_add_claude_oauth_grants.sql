-- Refreshable subscription grants, separate from Cursor keys and macrod hashes.
-- KMS binds the encrypted JSON to purpose and user_id.
CREATE TABLE claude_oauth_grants (
    user_id TEXT PRIMARY KEY REFERENCES "User" ("id") ON DELETE CASCADE,
    grant_ciphertext BYTEA NOT NULL CHECK (octet_length(grant_ciphertext) > 0),
    kms_key_id TEXT NOT NULL CHECK (kms_key_id <> ''),
    encryption_version SMALLINT NOT NULL CHECK (encryption_version > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
