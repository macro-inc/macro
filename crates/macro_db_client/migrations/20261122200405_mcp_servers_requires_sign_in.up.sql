-- A server added by URL that answered a request without a token with HTTP
-- 401: it needs the user to sign in before it counts as connected. Signing
-- in stores a grant and clears it. A constant default is metadata-only.
ALTER TABLE mcp_servers
    ADD COLUMN requires_sign_in boolean NOT NULL DEFAULT false;
