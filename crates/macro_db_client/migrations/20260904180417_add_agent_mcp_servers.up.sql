-- Which Pipedream apps a persona hands its sessions, chosen from the whole
-- Pipedream catalog whether or not anyone has connected them. The egress proxy
-- resolves each slug against the session owner's own connections at call time
-- and answers an unconnected one with a model-readable "not connected" result,
-- so a selected app never needs a grant to be listed here.
CREATE TABLE agent_mcp_servers (
    bot_id uuid NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    -- Pipedream's `name_slug`, verbatim; the same charset the proxy's
    -- McpServerSlug::parse accepts, so every stored slug is dialable.
    app_slug text NOT NULL CHECK (app_slug ~ '^[a-z0-9_-]+$'),
    server_name text NOT NULL CHECK (server_name <> ''),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (bot_id, app_slug)
);

-- 'owner_connections' keeps today's behaviour (advertise whatever the session
-- owner has connected); 'selected' advertises exactly agent_mcp_servers.
ALTER TABLE agent_configs
    ADD COLUMN mcp_scope text NOT NULL DEFAULT 'owner_connections'
    CONSTRAINT agent_configs_mcp_scope_valid
        CHECK (mcp_scope IN ('owner_connections', 'selected'));
