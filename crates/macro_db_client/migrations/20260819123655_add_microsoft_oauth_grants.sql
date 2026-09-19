CREATE TABLE microsoft_oauth_grants (
    fusionauth_user_id text NOT NULL,
    email_address text NOT NULL,
    refresh_token_ciphertext bytea NOT NULL,
    encrypted_data_key bytea NOT NULL,
    nonce bytea NOT NULL,
    encryption_version integer NOT NULL,
    kms_key_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_refreshed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (fusionauth_user_id, email_address),
    CONSTRAINT microsoft_oauth_grants_lowercase_email CHECK (
        email_address = lower(email_address)
    ),
    CONSTRAINT microsoft_oauth_grants_email_not_empty CHECK (email_address <> ''),
    CONSTRAINT microsoft_oauth_grants_user_not_empty CHECK (fusionauth_user_id <> ''),
    CONSTRAINT microsoft_oauth_grants_ciphertext_not_empty CHECK (
        octet_length(refresh_token_ciphertext) > 0
    ),
    CONSTRAINT microsoft_oauth_grants_data_key_not_empty CHECK (
        octet_length(encrypted_data_key) > 0
    ),
    CONSTRAINT microsoft_oauth_grants_aes_gcm_nonce_length CHECK (
        octet_length(nonce) = 12
    ),
    CONSTRAINT microsoft_oauth_grants_encryption_version_positive CHECK (
        encryption_version > 0
    ),
    CONSTRAINT microsoft_oauth_grants_kms_key_id_not_empty CHECK (kms_key_id <> '')
);

-- The primary key's leading fusionauth_user_id column supports both exact grant
-- lookup and user-wide grant lifecycle operations without a redundant index.
