SET LOCAL lock_timeout = '2s';

-- Batch audit cannot reference an item: empty and fully failed imports are audited too.
CREATE TABLE password_import_activity (
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    import_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    format TEXT NOT NULL CHECK (format IN ('one_password_pux','one_password_csv','bitwarden_json','bitwarden_csv')),
    created SMALLINT NOT NULL CHECK (created BETWEEN 0 AND 25),
    already_present SMALLINT NOT NULL CHECK (already_present BETWEEN 0 AND 25),
    failed SMALLINT NOT NULL CHECK (failed BETWEEN 0 AND 25),
    folders INTEGER NOT NULL CHECK (folders BETWEEN 0 AND 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id,id),
    CHECK (created + already_present + failed <= 25)
);
