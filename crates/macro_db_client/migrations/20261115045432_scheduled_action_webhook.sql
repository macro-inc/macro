-- Routine webhooks: a POST to a routine's webhook URL starts a run of it.
--
-- A routine watches its webhook with a `webhook` event filter, which holds no
-- secret. A routine has at most one URL, minted by its owner: `hook_id` is the
-- URL's public id and `secret_hash` the SHA-256 of its random 256-bit secret,
-- which is never stored. Rotating replaces both; saving the routine without
-- the filter or deleting it deletes the row, which revokes the URL.
--
-- The foreign key locks scheduled_action briefly, so it waits little behind it.
SET LOCAL lock_timeout = '5s';

CREATE TABLE scheduled_action_webhook (
    action_id UUID PRIMARY KEY REFERENCES scheduled_action (id) ON DELETE CASCADE,
    hook_id UUID NOT NULL UNIQUE,
    secret_hash BYTEA NOT NULL CHECK (octet_length(secret_hash) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
