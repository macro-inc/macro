-- Pipedream-managed MCP connectors, fully separate from the mcp_servers
-- table used by the native in-house OAuth stack. Pipedream owns
-- the OAuth grants and tokens; we store only which app a user connected and
-- the Pipedream connected-account ID the grant lives under.
CREATE TABLE pipedream_mcp_connections (
    user_id TEXT NOT NULL,
    app_slug TEXT NOT NULL,
    server_name TEXT NOT NULL,
    account_id TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, app_slug)
);
