-- Whether an MCP OAuth authorization shows the user its callback URL to carry to
-- the client, rather than redirecting to it, because the client's loopback
-- listener is on another machine than the browser. Defaulted so rows and writers
-- from the previous build keep redirecting.
ALTER TABLE mcp_oauth_pending_authorizations
    ADD COLUMN deliver_manually boolean NOT NULL DEFAULT false;
