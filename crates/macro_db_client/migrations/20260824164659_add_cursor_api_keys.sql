-- A user's Cursor API key, encrypted with AWS KMS.
--
-- One row per Macro user: a key is registered in settings and used for every
-- `@cursor` session that user starts, replacing the single deployment-wide key
-- the harness reads today.
--
-- The ciphertext is a KMS ciphertext blob produced by `kms:Encrypt` under an
-- encryption context of `purpose | encryption_version | user_id`, so KMS itself
-- refuses to decrypt a row moved to another user. That is why there is no
-- `encrypted_data_key` and no `nonce` here, unlike `microsoft_oauth_grants`: a
-- `crsr_` key is ~60 bytes, far under the 4 KB `kms:Encrypt` limit, so there is
-- no envelope to manage and no AES-GCM in our code to get wrong.
CREATE TABLE cursor_api_keys
(
    user_id              TEXT        NOT NULL
                                     REFERENCES "User" ("id") ON DELETE CASCADE,
    -- The KMS ciphertext blob. Opaque; only KMS can read it, and only with the
    -- matching encryption context.
    key_ciphertext       BYTEA       NOT NULL,
    -- Which encryption scheme produced `key_ciphertext`. Recorded even though
    -- there is only one today, so introducing a second is additive rather than
    -- a migration of existing rows.
    encryption_version   SMALLINT    NOT NULL,
    -- Which KMS key encrypted it. Automatic CMK rotation keeps old ciphertext
    -- readable under the same id, so this is for the other case: deliberately
    -- moving to a new key while old rows still decrypt under the old one.
    kms_key_id           TEXT        NOT NULL,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (user_id),

    CONSTRAINT cursor_api_keys_ciphertext_not_empty
        CHECK (OCTET_LENGTH(key_ciphertext) > 0),
    CONSTRAINT cursor_api_keys_encryption_version_positive
        CHECK (encryption_version > 0),
    CONSTRAINT cursor_api_keys_kms_key_id_not_empty
        CHECK (kms_key_id <> '')
);

-- Deliberately no `cursor_account_email` or `last_verified_at`: a key is
-- accepted on its shape alone, so nothing here could populate them honestly.
-- Both are worth adding the day registration confirms the key against
-- `GET /v1/me`, which is also what would let settings name the connected
-- account instead of only reporting that a key exists.

-- No secondary index: the primary key is the only lookup, since every read is
-- "the key for this user".
