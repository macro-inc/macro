CREATE TYPE github_app_installation_source_type AS ENUM ('team', 'user');

CREATE TABLE github_app_installation
(
    id TEXT NOT NULL, -- The github installation id converted to a string
    source_id TEXT NOT NULL, -- A team id or user id, depending on source_type
    source_type github_app_installation_source_type NOT NULL,
    PRIMARY KEY (id, source_id, source_type)
);

CREATE INDEX "github_app_installation_id_source_type_idx"
    ON github_app_installation (id, source_type);

CREATE INDEX "github_app_installation_source_type_source_id_idx"
    ON github_app_installation (source_type, source_id);

INSERT INTO github_app_installation (id, source_id, source_type)
SELECT id,
       team_id::TEXT,
       'team'::github_app_installation_source_type
FROM github_app_installation_team
ON CONFLICT DO NOTHING;

DROP TABLE github_app_installation_team;
