-- REST apps Macro signs in to with its own OAuth client (the connectors
-- crate's native API source; Autodesk first). One row per user and app.
--
-- The grant (access and refresh token) is stored only as a KMS envelope:
-- AES-256-GCM ciphertext under a data key that KMS encrypted with an
-- encryption context bound to the user and app, so a copied row does not
-- decrypt. A refresh rotates the refresh token, so the row is rewritten under
-- `SELECT ... FOR UPDATE` and replicas never spend one refresh token twice.
-- The row goes with its user.
--
-- The foreign key takes SHARE ROW EXCLUSIVE on "User"; give up rather than
-- queue behind a long query there and stall its writers.
SET LOCAL lock_timeout = '5s';
CREATE TABLE api_app_connections (
    user_id TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    app TEXT NOT NULL,
    name TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    -- The vendor refused the refresh token: only signing in again mends it.
    needs_reauth BOOLEAN NOT NULL DEFAULT FALSE,
    access_expires_at TIMESTAMPTZ NOT NULL,
    grant_ciphertext BYTEA NOT NULL,
    encrypted_data_key BYTEA NOT NULL,
    nonce BYTEA NOT NULL,
    encryption_version SMALLINT NOT NULL,
    kms_key_id TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, app)
);

-- Background syncs list an app's holders.
CREATE INDEX api_app_connections_app_idx ON api_app_connections (app, user_id);
