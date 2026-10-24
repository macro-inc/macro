-- One webhook URL per routine. The URL's token is its only credential, so
-- only its SHA-256 is kept; the prefix lets the owner recognize it.
CREATE TABLE scheduled_action_webhook (
    action_id UUID PRIMARY KEY REFERENCES scheduled_action (id) ON DELETE CASCADE,
    token_prefix TEXT NOT NULL,
    token_hash BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Routine triggers may now name GitHub App deliveries and webhook URL
-- deliveries; their event runs keep the delivery's payload until they
-- finish, since neither source can be read again at dispatch.
COMMENT ON COLUMN scheduled_action_event_run.event_context IS
    'Event name and its Macro entity and message ids; GitHub and webhook deliveries also keep their bounded payload until the run finishes.';
