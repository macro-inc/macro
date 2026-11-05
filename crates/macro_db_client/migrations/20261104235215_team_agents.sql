-- Team agents: AI teammates that are real Macro accounts on a team, each on
-- its own Macro computer. Identity and provisioning status only; the persona
-- (job, personality) lives in the agent's workspace repo.
-- Deleting the account or the team deletes the row; deleting the creator
-- keeps the agent and clears the reference.
CREATE TABLE team_agents (
    user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,
    mailbox_id TEXT,
    -- The Macro computer bought for the agent; set once the purchase commits.
    computer_id UUID,
    status TEXT NOT NULL DEFAULT 'provisioning'
        CHECK (status IN ('provisioning', 'running', 'failed')),
    status_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX team_agents_team_id_idx ON team_agents (team_id);
