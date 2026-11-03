-- Team agents: AI teammates that are real Macro user accounts on a team.
-- One row marks the account as an agent and holds its profile and brain.
-- Deleting the account or the team deletes the row; deleting the creator or
-- the brain's runtime keeps the agent and clears the reference.
CREATE TABLE team_agents (
    user_id TEXT PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    created_by TEXT REFERENCES "User"(id) ON DELETE SET NULL,
    job_description TEXT NOT NULL,
    personality TEXT NOT NULL,
    harness_id UUID REFERENCES harnesses(id) ON DELETE SET NULL,
    mailbox_id TEXT,
    brain_bot_id UUID,
    brain_session_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX team_agents_team_id_idx ON team_agents (team_id);
