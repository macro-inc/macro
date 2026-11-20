-- MCP Events extension webhook subscriptions (`events/subscribe`): a user's
-- agent asks for Macro events at a callback URL until the subscription
-- expires. Kept apart from `webhook`: these expire, are deleted outright,
-- carry a client-supplied signing secret encrypted with KMS, and never appear
-- in the webhooks API.
--
-- Both foreign keys to "User" take SHARE ROW EXCLUSIVE on it, blocking its
-- writers until this file commits; everything else touches only new tables.
SET LOCAL lock_timeout = '5s';

CREATE TABLE mcp_event_subscription (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    -- The MCP subscription id: derived from (user, endpoint, event type,
    -- arguments), so subscribing again with the same key refreshes this row.
    subscription_id TEXT NOT NULL,
    -- The MCP event type subscribed to, e.g. `macro.events`.
    event_type TEXT NOT NULL,
    -- The subscribe arguments, canonical JSON.
    arguments JSONB NOT NULL,
    -- The compiled filter delivery matches against.
    filter JSONB NOT NULL,
    endpoint_url TEXT NOT NULL,
    secret_ciphertext BYTEA NOT NULL,
    secret_kms_key_id TEXT NOT NULL,
    secret_encryption_version SMALLINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscribe, unsubscribe and the per-user quota start from the user.
CREATE UNIQUE INDEX mcp_event_subscription_user_subscription_uq
    ON mcp_event_subscription (user_id, subscription_id);

-- The expiry sweep reads the oldest expired rows first.
CREATE INDEX mcp_event_subscription_expires_at_idx
    ON mcp_event_subscription (expires_at);

-- One row per Macro event name a subscription's filter can match, so matching
-- an event reads only its audience's subscriptions to that event.
CREATE TABLE mcp_event_subscription_event (
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
    event_name TEXT NOT NULL,
    subscription_row_id UUID NOT NULL REFERENCES mcp_event_subscription(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, event_name, subscription_row_id)
);

-- Deleting a subscription cascades here by row id.
CREATE INDEX mcp_event_subscription_event_subscription_idx
    ON mcp_event_subscription_event (subscription_row_id);
