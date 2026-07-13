CREATE TABLE IF NOT EXISTS mcp_servers (
    user_id     TEXT    NOT NULL REFERENCES "User" ("id") ON DELETE CASCADE,
    url         TEXT    NOT NULL,
    server_name TEXT    NOT NULL,
    credentials BYTEA,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, url)
);

CREATE INDEX idx_mcp_servers_user_id ON mcp_servers (user_id);
