-- Which backend holds a connection's grant: Pipedream Connect, or Macro
-- Connect (`connect`). For `connect` rows, `account_id` is Connect's app id
-- and `app_slug` stays the Pipedream slug the app replaces, so tool
-- selection and agent egress keep keying connections by slug.
ALTER TABLE pipedream_mcp_connections
    ADD COLUMN provider TEXT NOT NULL DEFAULT 'pipedream'
        CONSTRAINT pipedream_mcp_connections_provider_check
        CHECK (provider IN ('pipedream', 'connect'));
