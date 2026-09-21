-- Deployment is additive. No workspace is approved or enabled by this migration.
CREATE TABLE team_privacy (
    team_id UUID PRIMARY KEY REFERENCES team(id) ON DELETE CASCADE,
    hipaa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    hipaa_approved_at TIMESTAMPTZ,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Intentionally survives workspace deletion. Contains only the security decision,
-- actor and time; never message/document contents. Retention is an operations policy.
CREATE TABLE team_privacy_audit (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL,
    actor_user_id TEXT NOT NULL,
    enabled BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX team_privacy_audit_team_time ON team_privacy_audit(team_id, created_at);
