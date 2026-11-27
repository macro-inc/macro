-- MCP Events extension webhook subscriptions (`events/subscribe`): a user's
-- agent asks for Macro events at a callback URL until the subscription
-- expires. Kept apart from `webhook`: these expire, are deleted outright,
-- carry a client-supplied signing secret encrypted with KMS, and never appear
-- in the webhooks API.
--
-- The foreign key to "User" takes SHARE ROW EXCLUSIVE on it, blocking its
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- The target of the index table's foreign key, which carries the user.
    UNIQUE (id, user_id)
);

-- Subscribe and unsubscribe address a subscription by user and id.
CREATE UNIQUE INDEX mcp_event_subscription_user_subscription_uq
    ON mcp_event_subscription (user_id, subscription_id);

-- The quota and the verified-endpoint check read only a user's live rows,
-- however many expired ones wait for the sweep.
CREATE INDEX mcp_event_subscription_user_expires_at_idx
    ON mcp_event_subscription (user_id, expires_at);

-- The expiry sweep reads the oldest expired rows first. Each replica's
-- refresh of who holds a live subscription reads the live end, index only.
CREATE INDEX mcp_event_subscription_expires_at_idx
    ON mcp_event_subscription (expires_at) INCLUDE (user_id);

-- One row per Macro event name a subscription's filter can match, so matching
-- an event reads only its audience's live subscriptions to that event. The
-- user and expiry are copies of the subscription's, rewritten with it; the
-- user follows the subscription's through the foreign key, so nothing here
-- locks "User" (a refresh would otherwise deadlock with account deletion).
CREATE TABLE mcp_event_subscription_event (
    subscription_row_id UUID NOT NULL,
    event_name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    -- The user sits between the two so the foreign key's cascade, which
    -- deletes by (subscription_row_id, user_id), reads one subscription's rows
    -- through this index rather than a whole user's range of the match index.
    PRIMARY KEY (subscription_row_id, user_id, event_name),
    FOREIGN KEY (subscription_row_id, user_id)
        REFERENCES mcp_event_subscription (id, user_id)
        ON DELETE CASCADE ON UPDATE CASCADE
);

-- Matching: the audience's live rows for one event, expired ones skipped by
-- the index range.
CREATE INDEX mcp_event_subscription_event_match_idx
    ON mcp_event_subscription_event (user_id, event_name, expires_at)
    INCLUDE (subscription_row_id);
