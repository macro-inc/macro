-- A routine's webhook URL: a secret that starts the routine with whatever
-- text is POSTed to it. A routine has at most one; making a new one replaces
-- it. Only the token's SHA-256 is kept; the raw token is shown once, when it
-- is made. The URL goes with its routine.
CREATE TABLE scheduled_action_webhook (
    action_id UUID PRIMARY KEY REFERENCES scheduled_action(id) ON DELETE CASCADE,
    token_hash BYTEA NOT NULL UNIQUE CHECK (length(token_hash) = 32),
    -- The token's first characters, so the routine can show which URL it has
    -- without holding the secret.
    token_prefix TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
