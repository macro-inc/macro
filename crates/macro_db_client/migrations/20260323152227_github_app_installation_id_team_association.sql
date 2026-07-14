-- Adds new table that associates a github app installation with a given team id
CREATE TABLE github_app_installation_team
(
    id TEXT NOT NULL, -- The github installation id converted to a string
    team_id UUID NOT NULL REFERENCES "team" ("id") ON DELETE CASCADE,
    installed_by TEXT NOT NULL REFERENCES "User" ("id") ON DELETE CASCADE,
    PRIMARY KEY (id, team_id)
);

-- Allow for github app installation id lookup by team id
CREATE INDEX "github_app_installation_team_team_id_idx" ON github_app_installation_team ("team_id");
