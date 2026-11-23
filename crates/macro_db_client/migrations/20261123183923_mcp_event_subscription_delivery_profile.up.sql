-- MCP Events subscriptions made through ChatGPT follow its conventions, and a
-- refresh that replaces a subscription's signing secret keeps the old one for
-- a short window, during which deliveries are signed with both.
--
-- Adding nullable columns, and one with a constant default, rewrites no rows
-- and scans nothing; the ALTER holds ACCESS EXCLUSIVE on the table only for
-- the catalog change.
SET LOCAL lock_timeout = '5s';

ALTER TABLE mcp_event_subscription
    -- `mcp` (as specified) or `chatgpt` (webhook-id equal to eventId, data
    -- without people's ids or emails). Checked by the application, so adding
    -- the column validates nothing.
    ADD COLUMN delivery_profile TEXT NOT NULL DEFAULT 'mcp',
    ADD COLUMN previous_secret_ciphertext BYTEA,
    ADD COLUMN previous_secret_kms_key_id TEXT,
    ADD COLUMN previous_secret_encryption_version SMALLINT,
    -- When deliveries stop signing with the previous secret.
    ADD COLUMN previous_secret_expires_at TIMESTAMPTZ;
