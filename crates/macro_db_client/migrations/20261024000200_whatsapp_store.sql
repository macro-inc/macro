-- The whatsmeow device store of a linked WhatsApp account (crates/whatsapp_store_pg).
--
-- Every value column holds AES-256-GCM ciphertext under the account's data key,
-- which is itself only stored wrapped by KMS (whatsapp_device). Lookup keys
-- (Signal addresses, JIDs, prekey ids, MACs) stay plaintext so they can be
-- indexed. Everything cascades from the account, so deleting the account or
-- the device row removes every key and session.

CREATE TABLE whatsapp_device (
    account_id uuid PRIMARY KEY REFERENCES whatsapp_linked_account (id) ON DELETE CASCADE,
    -- The account's data key, wrapped by KMS under the account's encryption context.
    data_key_ciphertext bytea NOT NULL,
    kms_key_id text NOT NULL,
    encryption_version smallint NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Values with point and prefix lookups only. `key` is byte-ordered (C
-- collation) so `LIKE 'prefix%'` deletes use the primary key.
CREATE TABLE whatsapp_store_value (
    account_id uuid NOT NULL REFERENCES whatsapp_device (account_id) ON DELETE CASCADE,
    store text NOT NULL,
    key text COLLATE "C" NOT NULL,
    nonce bytea NOT NULL CHECK (length(nonce) = 12),
    value bytea NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, store, key)
);

-- One-time prekeys: numbered, listed in order, counted by upload state.
CREATE TABLE whatsapp_pre_key (
    account_id uuid NOT NULL REFERENCES whatsapp_device (account_id) ON DELETE CASCADE,
    key_id bigint NOT NULL CHECK (key_id BETWEEN 0 AND 4294967295),
    uploaded boolean NOT NULL DEFAULT false,
    nonce bytea NOT NULL CHECK (length(nonce) = 12),
    -- The encrypted private key.
    value bytea NOT NULL,
    PRIMARY KEY (account_id, key_id)
);

-- App state mutation MACs: the newest version per index MAC, and batch deletes
-- by index MAC. The index MAC is keyed by an app state key, so it reveals
-- nothing without one; the value MAC is encrypted.
CREATE TABLE whatsapp_app_state_mutation_mac (
    account_id uuid NOT NULL REFERENCES whatsapp_device (account_id) ON DELETE CASCADE,
    name text NOT NULL,
    index_mac bytea NOT NULL,
    version bigint NOT NULL,
    nonce bytea NOT NULL CHECK (length(nonce) = 12),
    value bytea NOT NULL,
    PRIMARY KEY (account_id, name, index_mac, version)
);

-- Privacy tokens, deleted by age.
CREATE TABLE whatsapp_privacy_token (
    account_id uuid NOT NULL REFERENCES whatsapp_device (account_id) ON DELETE CASCADE,
    user_jid text NOT NULL,
    token_timestamp timestamptz NOT NULL,
    nonce bytea NOT NULL CHECK (length(nonce) = 12),
    value bytea NOT NULL,
    PRIMARY KEY (account_id, user_jid)
);

-- Decrypted incoming events, kept so a redelivery isn't decrypted twice and
-- deleted after 14 days. The plaintext is cleared (nonce and value null) once
-- the event is handled.
CREATE TABLE whatsapp_event_buffer (
    account_id uuid NOT NULL REFERENCES whatsapp_device (account_id) ON DELETE CASCADE,
    ciphertext_hash bytea NOT NULL CHECK (length(ciphertext_hash) = 32),
    server_time timestamptz NOT NULL,
    inserted_at timestamptz NOT NULL DEFAULT now(),
    nonce bytea CHECK (length(nonce) = 12),
    value bytea,
    PRIMARY KEY (account_id, ciphertext_hash),
    CHECK ((nonce IS NULL) = (value IS NULL))
);

CREATE INDEX whatsapp_event_buffer_inserted_at_idx ON whatsapp_event_buffer (account_id, inserted_at);

-- Sent messages kept for answering retry receipts, deleted after 7 days.
CREATE TABLE whatsapp_outgoing_event (
    account_id uuid NOT NULL REFERENCES whatsapp_device (account_id) ON DELETE CASCADE,
    chat_jid text NOT NULL,
    message_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    nonce bytea NOT NULL CHECK (length(nonce) = 12),
    value bytea NOT NULL,
    PRIMARY KEY (account_id, chat_jid, message_id)
);

CREATE INDEX whatsapp_outgoing_event_created_at_idx ON whatsapp_outgoing_event (account_id, created_at);
