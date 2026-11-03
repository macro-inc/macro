SET LOCAL lock_timeout = '2s';
ALTER TABLE saved_view ADD COLUMN revision bigint NOT NULL DEFAULT 1;
ALTER TABLE saved_view ADD COLUMN shared_team_id uuid;
ALTER TABLE saved_view ADD CONSTRAINT saved_view_shared_team_id_fkey
    FOREIGN KEY (shared_team_id) REFERENCES team(id) ON DELETE SET NULL NOT VALID;
