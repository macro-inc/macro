-- The runtime's prompt and the broker's announcement can arrive in either
-- order. Their shared action ID is the triggering message ID, scoped to the
-- session so multiple agents can answer the same message independently.
CREATE TABLE agent_external_replies (
    session_id UUID NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    action_id UUID NOT NULL,
    target JSONB,
    completion JSONB,
    finalized BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, action_id)
);

CREATE INDEX agent_external_replies_pending ON agent_external_replies(updated_at)
    WHERE target IS NOT NULL AND NOT finalized;
