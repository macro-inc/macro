-- Sharing exposes configuration and history; execution remains owned by the creator.
CREATE TABLE routine_team_share (
    action_id uuid PRIMARY KEY REFERENCES scheduled_action(id) ON DELETE CASCADE,
    team_id uuid NOT NULL REFERENCES team(id) ON DELETE CASCADE
);
CREATE INDEX routine_team_share_team_id_idx ON routine_team_share(team_id);
