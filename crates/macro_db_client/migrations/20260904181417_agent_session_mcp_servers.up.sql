-- Snapshot of the agent's MCP policy at session creation, like `instructions`:
-- the ACP agent is handed its server list once per attach and cannot refresh
-- it, so the egress proxy must enforce exactly what was advertised for the
-- session's whole life. Editing the agent applies to its next session.
ALTER TABLE agent_session
    ADD COLUMN mcp_scope text NOT NULL DEFAULT 'owner_connections'
        CONSTRAINT agent_session_mcp_scope_valid
        CHECK (mcp_scope IN ('owner_connections', 'selected')),
    -- [{"app_slug": "linear", "server_name": "Linear"}, ...]; empty unless
    -- mcp_scope is 'selected'.
    ADD COLUMN mcp_servers jsonb NOT NULL DEFAULT '[]'::jsonb;
