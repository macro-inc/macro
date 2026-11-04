-- Digest of the secret cookie held by the browser that started an MCP OAuth
-- authorization; only that browser may complete it. Nullable because rows
-- written by the previous build carry no binding.
ALTER TABLE mcp_oauth_pending_authorizations
    ADD COLUMN browser_binding_digest text;
