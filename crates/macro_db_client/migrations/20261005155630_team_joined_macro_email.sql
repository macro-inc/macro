CREATE TABLE team_joined_macro_email (
    team_id UUID NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, email)
);
