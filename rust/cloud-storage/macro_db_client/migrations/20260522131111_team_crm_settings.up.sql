CREATE TABLE IF NOT EXISTS team_crm_settings
(
    team_id     UUID        PRIMARY KEY NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    crm_enabled BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
