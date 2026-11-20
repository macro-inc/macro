-- An agent teammate's own email inbox, as crates/team_agents tracks it: the
-- request id every provision of it reuses (one mailbox per agent), the
-- mailbox email_service made, and the last state it reported. The mailbox
-- itself, its credentials and its mail live in email_service. Goes with the
-- agent's seat: once the agent is removed email_service keeps the paused
-- mailbox until it releases it.

SET LOCAL lock_timeout = '5s';

CREATE TABLE team_agent_inboxes (
    agent_user_id TEXT PRIMARY KEY REFERENCES team_agents (user_id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    request_id UUID NOT NULL UNIQUE,
    mailbox_id UUID UNIQUE,
    address TEXT,
    state TEXT NOT NULL CHECK (
        state IN ('provisioning', 'active', 'failed', 'paused', 'releasing', 'released')
    ),
    last_error TEXT CHECK (
        last_error IN (
            'not_configured', 'address_taken', 'quota_exceeded', 'unavailable',
            'rejected'
        )
    ),
    -- A stand-in provider serves the mailbox (local stacks, previews): no
    -- real mail moves.
    fake_provider BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX team_agent_inboxes_team_id_idx ON team_agent_inboxes (team_id);
