ALTER TABLE customers
    ADD COLUMN allowed_redirect_origins text[] NOT NULL DEFAULT '{}';

ALTER TABLE connections
    ADD COLUMN oauth_issuer text,
    ADD COLUMN oauth_client_id text,
    ADD COLUMN oauth_registration_kind text;

CREATE TABLE connect_sessions (
    token text PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    external_user_id text NOT NULL,
    app_id text NOT NULL,
    redirect_url text NOT NULL,
    expires_at timestamptz NOT NULL,
    session_traceparent text
);

CREATE INDEX connect_sessions_expires_at_idx ON connect_sessions (expires_at);

CREATE TABLE oauth_states (
    state text PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    external_user_id text NOT NULL,
    app_id text NOT NULL,
    redirect_url text NOT NULL,
    client_id text NOT NULL,
    issuer text NOT NULL,
    registration_kind text NOT NULL,
    verifier_ciphertext bytea NOT NULL,
    verifier_nonce bytea NOT NULL CHECK (octet_length(verifier_nonce) = 12),
    verifier_encrypted_data_key bytea NOT NULL,
    verifier_kms_key_id text NOT NULL,
    verifier_encryption_version smallint NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    authorize_traceparent text
);

CREATE INDEX oauth_states_expires_at_idx ON oauth_states (expires_at);

CREATE TABLE oauth_clients (
    issuer text NOT NULL,
    redirect_uri text NOT NULL,
    client_id text NOT NULL,
    secret_ciphertext bytea,
    secret_nonce bytea,
    secret_encrypted_data_key bytea,
    secret_kms_key_id text,
    secret_encryption_version smallint,
    CONSTRAINT oauth_clients_secret_complete CHECK (
        (secret_ciphertext IS NULL AND secret_nonce IS NULL AND secret_encrypted_data_key IS NULL AND secret_kms_key_id IS NULL AND secret_encryption_version IS NULL)
        OR (secret_ciphertext IS NOT NULL AND secret_nonce IS NOT NULL AND secret_encrypted_data_key IS NOT NULL AND secret_kms_key_id IS NOT NULL AND secret_encryption_version IS NOT NULL)
    ),
    PRIMARY KEY (issuer, redirect_uri)
);
