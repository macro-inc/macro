-- OAuth broker state for the public MCP server (`mcp_auth_proxy`), moved out
-- of the shared Redis cache. Every row carries its own expiry; reads ignore
-- expired rows and the broker's cleanup task deletes them.

-- Clients created through dynamic client registration. `expires_at` slides
-- forward each time the registration is used.
CREATE TABLE mcp_oauth_clients (
    client_id text PRIMARY KEY,
    client_name text NOT NULL,
    redirect_uris text[] NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);

CREATE INDEX mcp_oauth_clients_expires_at_idx ON mcp_oauth_clients (expires_at);

-- Which client and grant each outstanding refresh token was issued to, keyed
-- by the SHA-256 digest of the token so no usable credential is stored. Every
-- token rotated out of one authorization code shares a `grant_id`. Not a
-- foreign key: a binding outlives neither its token nor the check it feeds,
-- and expires on its own schedule.
CREATE TABLE mcp_oauth_refresh_token_bindings (
    refresh_token_digest text PRIMARY KEY,
    client_id text NOT NULL,
    grant_id text NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE INDEX mcp_oauth_refresh_token_bindings_expires_at_idx
    ON mcp_oauth_refresh_token_bindings (expires_at);

-- Grants revoked through `/revoke`. A refresh token whose binding names one is
-- refused, so a revocation that raced a refresh still covers the token that
-- refresh rotated to. Kept at least as long as any binding in the family.
CREATE TABLE mcp_oauth_revoked_grants (
    grant_id text PRIMARY KEY,
    expires_at timestamptz NOT NULL
);

CREATE INDEX mcp_oauth_revoked_grants_expires_at_idx
    ON mcp_oauth_revoked_grants (expires_at);

-- Authorization requests waiting for the upstream login, keyed by the broker
-- session id carried through the upstream `state`.
CREATE TABLE mcp_oauth_pending_authorizations (
    session_id text PRIMARY KEY,
    client_id text NOT NULL,
    code_challenge text NOT NULL,
    client_state text NOT NULL,
    client_redirect_uri text NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE INDEX mcp_oauth_pending_authorizations_expires_at_idx
    ON mcp_oauth_pending_authorizations (expires_at);

-- Authorization codes the broker issued, keyed by the SHA-256 digest of the
-- code. The upstream tokens the code redeems for are KMS-encrypted, with the
-- code digest and client in the encryption context.
CREATE TABLE mcp_oauth_authorization_codes (
    code_digest text PRIMARY KEY,
    client_id text NOT NULL,
    tokens_ciphertext bytea NOT NULL,
    kms_key_id text NOT NULL,
    encryption_version smallint NOT NULL,
    code_challenge text NOT NULL,
    redirect_uri text NOT NULL,
    access_token_expires_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
);

CREATE INDEX mcp_oauth_authorization_codes_expires_at_idx
    ON mcp_oauth_authorization_codes (expires_at);
