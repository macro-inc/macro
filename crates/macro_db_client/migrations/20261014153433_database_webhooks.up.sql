-- Incoming webhooks: a secret URL that inserts rows into one table of a
-- Macro database. Only the token's SHA-256 is kept; the raw token is shown
-- once, when the webhook is created. A webhook goes with its table, its
-- database entity, and the user who created it, whose access its writes use.
CREATE TABLE database_webhooks (
    id UUID PRIMARY KEY,
    database_id UUID NOT NULL REFERENCES database_entities(database_id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES database_tables(id) ON DELETE CASCADE,
    created_by TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE,
    -- The token's first characters, so a list can tell webhooks apart
    -- without holding the secret.
    token_prefix TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX database_webhooks_database_id_idx ON database_webhooks(database_id);
CREATE INDEX database_webhooks_table_id_idx ON database_webhooks(table_id);
