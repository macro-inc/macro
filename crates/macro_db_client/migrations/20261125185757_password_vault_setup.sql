-- Automatic team vault setup. One row per team once a write first finds no
-- namespace; it holds no item, request body, credential or token. Purging the
-- team's vault metadata deletes the row; the closed-team fence stays in
-- password_team_lifecycle, so a deleted team is never set up again.
CREATE TABLE password_vault_setup (
    team_id UUID PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('setting_up', 'ready', 'failed', 'needs_recovery')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- The resume worker reads only teams still being set up, oldest attempt first.
CREATE INDEX password_vault_setup_due ON password_vault_setup(next_attempt_at)
    WHERE state = 'setting_up';
