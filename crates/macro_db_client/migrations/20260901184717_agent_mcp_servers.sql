-- The MCP servers an agent may use, beyond Macro's own server that every agent
-- has. Each row names a server the configuring user registered in their
-- settings: on the native stack by URL (`mcp_servers.url`), on the Pipedream
-- stack by app slug (`pipedream_mcp_connections.app_slug`). Only the
-- reference is stored - credentials stay with whoever owns the session, and
-- are resolved against that person's own registrations at run time - so
-- there is no foreign key into either registry.
CREATE TABLE agent_mcp_servers (
    bot_id UUID NOT NULL REFERENCES agent_configs(bot_id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('native', 'pipedream')),
    server_ref TEXT NOT NULL CHECK (server_ref <> ''),
    -- Order the user arranged them in, preserved on read.
    position INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (bot_id, kind, server_ref)
);
