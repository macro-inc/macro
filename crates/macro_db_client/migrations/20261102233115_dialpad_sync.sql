-- Dialpad call sync. The Dialpad grant lives in Macro Connect; these rows hold
-- only what sync needs: the Dialpad resources it registered and the webhook
-- signing secret it chose (sealed with the row id).
CREATE TABLE dialpad_sync_connections (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE CASCADE,
    -- Import identity in call_entity_sources; survives reconnects.
    namespace UUID NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    dialpad_user_id BIGINT,
    webhook_id BIGINT,
    subscription_id BIGINT,
    signing_secret BYTEA,
    backfill_since TIMESTAMPTZ,
    backfill_cursor TEXT,
    -- A failing backfill backs off and moves behind the others, so it never
    -- holds up anyone else's import of past calls.
    backfill_failures INTEGER NOT NULL DEFAULT 0,
    backfill_due_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    setup_started_at TIMESTAMPTZ,
    -- Setup failures in a row; setup stops retrying at a cap until the user
    -- reconnects.
    setup_attempts INTEGER NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMPTZ,
    last_error TEXT,
    CHECK ((webhook_id IS NULL) = (subscription_id IS NULL)),
    CHECK (NOT enabled OR (webhook_id IS NOT NULL AND signing_secret IS NOT NULL AND dialpad_user_id IS NOT NULL))
);

-- Dialpad delivers at least once and out of order, with no event id. A call's
-- events are kept together: each import rebuilds the call from all of them.
CREATE TABLE dialpad_sync_events (
    connection_id UUID NOT NULL REFERENCES dialpad_sync_connections(id) ON DELETE CASCADE,
    call_id BIGINT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('hangup', 'call_transcription', 'recap_summary', 'recap_action_items', 'backfill')),
    occurred_at TIMESTAMPTZ NOT NULL,
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    -- W3C trace context of the delivery, so its import joins the same trace.
    traceparent TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    attempts INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lease_id UUID,
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (connection_id, call_id, state, occurred_at)
);
CREATE INDEX dialpad_sync_events_pending_idx ON dialpad_sync_events(available_at)
    WHERE completed_at IS NULL;
