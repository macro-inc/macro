-- MCP Events extension webhook subscriptions (`events/subscribe`): a user's
-- agent asks for Macro events at a callback URL until the subscription
-- expires. Kept apart from `webhook`: these expire, are deleted outright,
-- carry a client-supplied signing secret encrypted with KMS, and never appear
-- in the webhooks API.
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
    -- Every Macro event name the filter can match, for the match probe.
    events TEXT[] NOT NULL CONSTRAINT mcp_event_subscription_events_not_empty CHECK (cardinality(events) > 0),
    endpoint_url TEXT NOT NULL,
    secret_ciphertext BYTEA NOT NULL,
    secret_kms_key_id TEXT NOT NULL,
    secret_encryption_version SMALLINT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscribe, unsubscribe, the per-user quota and delivery matching all start
-- from the user.
CREATE UNIQUE INDEX mcp_event_subscription_user_subscription_uq
    ON mcp_event_subscription (user_id, subscription_id);
