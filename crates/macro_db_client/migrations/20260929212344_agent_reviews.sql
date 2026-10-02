-- Metadata is small; full source bodies live in the session changes bucket.
-- Deleting a session removes metadata, feedback leases, and capture leases.
CREATE TABLE agent_review (
    agent_session_id UUID PRIMARY KEY REFERENCES agent_session(id) ON DELETE CASCADE,
    review_id UUID NOT NULL UNIQUE,
    version BIGINT NOT NULL CHECK (version > 0),
    state JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE agent_review_capture (
    agent_session_id UUID PRIMARY KEY REFERENCES agent_session(id) ON DELETE CASCADE,
    claim UUID NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE agent_review_feedback (
    agent_session_id UUID NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    message_id UUID NOT NULL,
    delivered BOOLEAN NOT NULL DEFAULT false,
    lease_until TIMESTAMPTZ,
    PRIMARY KEY (agent_session_id, message_id)
);

-- Accepted action IDs outlive the prompt queue and deduplicate review retries
-- after a turn finishes. Written atomically with the durable queue admission.
CREATE TABLE agent_session_action_receipt (
    agent_session_id UUID NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE,
    action_id UUID NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (agent_session_id, action_id)
);
