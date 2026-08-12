-- Pre-registered OAuth credentials for MCP providers that don't support
-- Dynamic Client Registration (e.g. HubSpot). `client_secret` is AES-256-GCM
-- encrypted at rest by the MCP server repo, matching `credentials`.
ALTER TABLE mcp_servers
ADD COLUMN IF NOT EXISTS client_id TEXT,
ADD COLUMN IF NOT EXISTS client_secret BYTEA;
