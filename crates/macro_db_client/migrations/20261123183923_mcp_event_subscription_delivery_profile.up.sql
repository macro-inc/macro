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
    ADD COLUMN previous_secret_expires_at TIMESTAMPTZ,
    -- A ChatGPT row's secrets are sealed under encryption version 2, which a
    -- build from before delivery profiles cannot open, so it never sends such
    -- a row's events unredacted. This keeps that build's refresh, which
    -- writes a version 1 secret and leaves the profile as it is, from
    -- pairing one with a ChatGPT row. NOT VALID: the rows already stored are
    -- all `mcp`, so there is nothing to scan for.
    ADD CONSTRAINT mcp_event_subscription_chatgpt_secret_version CHECK (
        delivery_profile <> 'chatgpt'
        OR (
            secret_encryption_version = 2
            AND coalesce(previous_secret_encryption_version, 2) = 2
        )
    ) NOT VALID;
