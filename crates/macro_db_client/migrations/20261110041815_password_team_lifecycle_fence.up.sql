-- Retain the closed identity after successful erasure so retries and delayed
-- senders cannot reopen a namespace whose team metadata has been removed.
CREATE TABLE password_team_lifecycle (
    team_id UUID PRIMARY KEY,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
