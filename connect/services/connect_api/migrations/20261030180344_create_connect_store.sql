CREATE TABLE customers (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_api_keys (
    id uuid PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    key_hash bytea NOT NULL CHECK (octet_length(key_hash) = 32),
    prefix text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);

CREATE TABLE connections (
    id uuid PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    external_user_id text NOT NULL,
    app_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('active', 'needs_reauth')),
    scopes text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (customer_id, external_user_id, app_id)
);

CREATE TABLE grants (
    connection_id uuid PRIMARY KEY REFERENCES connections(id) ON DELETE CASCADE,
    ciphertext bytea NOT NULL,
    nonce bytea NOT NULL CHECK (octet_length(nonce) = 12),
    encrypted_data_key bytea NOT NULL,
    kms_key_id text NOT NULL,
    encryption_version smallint NOT NULL,
    access_token_expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
