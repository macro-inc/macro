-- `cursor_api_keys` becomes `cursor_configs`.
--
-- The table was a key store; it is now a user's whole Cursor configuration,
-- of which the encrypted key is one field and the chosen default model is the
-- next. The rename keeps the name honest before more config lands on the row.
--
-- `RENAME TO` is metadata-only and atomic — no rewrite, no data lock — and the
-- primary key follows automatically. The three CHECK constraints carry the old
-- table name in their own names, so they are renamed too; otherwise a future
-- constraint violation would report a table that no longer exists.
ALTER TABLE cursor_api_keys RENAME TO cursor_configs;
ALTER TABLE cursor_configs RENAME CONSTRAINT cursor_api_keys_ciphertext_not_empty
    TO cursor_configs_ciphertext_not_empty;
ALTER TABLE cursor_configs RENAME CONSTRAINT cursor_api_keys_encryption_version_positive
    TO cursor_configs_encryption_version_positive;
ALTER TABLE cursor_configs RENAME CONSTRAINT cursor_api_keys_kms_key_id_not_empty
    TO cursor_configs_kms_key_id_not_empty;

-- The model a user's `@cursor` sessions start on, as a Cursor model id (e.g.
-- `grok-4.6`). NULL means "use the deployment's built-in default", so every
-- existing row is valid without a backfill. Only the id is stored: its
-- parameters are resolved from Cursor's own default variant for that model at
-- session start, since Cursor rejects an id whose parameters are not a variant
-- it knows, and that variant table can change between now and then.
ALTER TABLE cursor_configs ADD COLUMN default_model_id TEXT;

ALTER TABLE cursor_configs ADD CONSTRAINT cursor_configs_default_model_id_not_empty
    CHECK (default_model_id IS NULL OR default_model_id <> '');
