-- An agent teammate's own email inbox, as crates/team_agents tracks it: the
-- request id every provision of it reuses (one mailbox per agent), the
-- mailbox email_service made, and the last state it reported. The mailbox
-- itself, its credentials and its mail live in email_service.
--
-- The record outlives the agent's seat and its team: removing the agent or
-- deleting the team marks it `pausing` or `releasing` first, and the inbox
-- sweep keeps telling email_service until it confirms (`paused`,
-- `released`), with a backoff per mark. It goes only with the agent's
-- account.

SET LOCAL lock_timeout = '5s';

CREATE TABLE team_agent_inboxes (
    agent_user_id TEXT PRIMARY KEY REFERENCES "User" (id) ON DELETE CASCADE,
    -- The team the agent was on; no foreign key, so a deleted team's
    -- records stay for the sweep.
    team_id UUID NOT NULL,
    request_id UUID NOT NULL UNIQUE,
    mailbox_id UUID UNIQUE,
    address TEXT,
    state TEXT NOT NULL CHECK (
        state IN (
            'provisioning', 'active', 'failed', 'pausing', 'paused', 'releasing', 'released'
        )
    ),
    last_error TEXT CHECK (
        last_error IN (
            'not_configured', 'address_taken', 'quota_exceeded', 'team_limit', 'unavailable',
            'rejected'
        )
    ),
    -- A stand-in provider serves the mailbox (local stacks, previews): no
    -- real mail moves.
    fake_provider BOOLEAN NOT NULL DEFAULT FALSE,
    -- The inbox sweep's backoff for a mark email_service hasn't confirmed.
    sweep_attempts SMALLINT NOT NULL DEFAULT 0,
    next_sweep_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '1 minute',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX team_agent_inboxes_team_id_idx ON team_agent_inboxes (team_id);

-- The inbox sweep's wind-downs still waiting on email_service.
CREATE INDEX team_agent_inboxes_unsettled_idx ON team_agent_inboxes (next_sweep_at)
    WHERE state IN ('pausing', 'releasing');

-- Live inboxes changed in the last hour, for the sweep's check that each
-- still has a seat (a provision racing its team's deletion).
CREATE INDEX team_agent_inboxes_live_changed_idx ON team_agent_inboxes (updated_at)
    WHERE state IN ('provisioning', 'active', 'failed');
