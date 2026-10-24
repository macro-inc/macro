-- Media import and sending for linked WhatsApp groups, and the passkey step of
-- pairing. Additive only.
SET lock_timeout = '5s';

-- WhatsApp's WebAuthn challenge and the owner's assertion pass through the
-- pairing row; both are cleared when the transaction ends.
ALTER TABLE whatsapp_pairing
    ADD COLUMN passkey_challenge jsonb CHECK (pg_column_size(passkey_challenge) <= 65536),
    ADD COLUMN passkey_response jsonb CHECK (pg_column_size(passkey_response) <= 65536),
    ADD CONSTRAINT whatsapp_pairing_passkey_cleared
        CHECK (consumed_at IS NULL OR (passkey_challenge IS NULL AND passkey_response IS NULL));

-- Attachment reservations become an import queue. The locator is sealed by the
-- session service with the observing account's key; Macro never reads it.
ALTER TABLE whatsapp_group_attachment
    ADD COLUMN account_id uuid REFERENCES whatsapp_linked_account(id) ON DELETE SET NULL,
    ADD COLUMN locator bytea CHECK (octet_length(locator) <= 8192),
    ADD COLUMN mime text CHECK (octet_length(mime) <= 128),
    ADD COLUMN filename text CHECK (octet_length(filename) <= 512),
    ADD COLUMN size bigint CHECK (size >= 0),
    ADD COLUMN claimed_epoch bigint,
    ADD COLUMN claimed_until timestamptz,
    ADD COLUMN attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN retry_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE whatsapp_group_attachment DROP CONSTRAINT whatsapp_group_attachment_state_check;
ALTER TABLE whatsapp_group_attachment ADD CONSTRAINT whatsapp_group_attachment_state_check
    CHECK (state IN ('pending', 'downloaded', 'ready', 'failed', 'deleted'));
CREATE INDEX whatsapp_group_attachment_download ON whatsapp_group_attachment(account_id, retry_at) WHERE state = 'pending';
CREATE INDEX whatsapp_group_attachment_import ON whatsapp_group_attachment(retry_at) WHERE state = 'downloaded';

-- Plaintext bytes between a download (or an upload) and their private Macro
-- document. Deleted once the document holds them; unsent uploads expire.
CREATE TABLE whatsapp_media_blob (
    document_id uuid PRIMARY KEY,
    group_id uuid NOT NULL REFERENCES whatsapp_group(id) ON DELETE CASCADE,
    -- Owner of the resulting document: the uploader, or the binding's content owner.
    user_id text NOT NULL,
    mime text NOT NULL CHECK (octet_length(mime) <= 128),
    filename text NOT NULL CHECK (octet_length(filename) BETWEEN 1 AND 512),
    sha256 bytea NOT NULL CHECK (octet_length(sha256) = 32),
    bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 33554432),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX whatsapp_media_blob_created ON whatsapp_media_blob(created_at);
