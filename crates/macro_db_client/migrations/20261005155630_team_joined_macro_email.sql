-- Claimed before each "x joined Macro" email, so a team emails an address at
-- most once, ever. Keyed by the address with no "User" FK: recipients usually
-- have no account yet, and the claim must outlive later signups and joins.
CREATE TABLE team_joined_macro_email (
    team_id UUID NOT NULL REFERENCES team (id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, email)
);
