-- Dormant envelopes. Existing APIs and workers do not read or populate them.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

-- Historical audit rows can predate incarnation-aware writers.
ALTER TABLE crm_email_policy_audit ADD COLUMN consent_incarnation UUID;

-- NULL is explicitly legacy work, never an invitation to adopt current consent.
-- The durable work row below survives publication; the outbox only delivers it.
ALTER TABLE crm_email_backfill_outbox
    ADD COLUMN link_id UUID,
    ADD COLUMN consent_incarnation UUID,
    ADD COLUMN policy_version BIGINT,
    ADD COLUMN work_id UUID,
    ADD CONSTRAINT crm_email_backfill_generation CHECK (
        num_nonnulls(link_id, consent_incarnation, policy_version, work_id) IN (0, 4)
        AND (policy_version IS NULL OR policy_version >= 0)
    ) NOT VALID;

CREATE TABLE crm_email_policy_idempotency (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    consent_incarnation UUID NOT NULL,
    request_id UUID NOT NULL,
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    expected_policy_version BIGINT NOT NULL CHECK (expected_policy_version >= 0),
    policy_version BIGINT NOT NULL CHECK (policy_version >= expected_policy_version),
    request_hash BYTEA NOT NULL CHECK (octet_length(request_hash) = 32),
    outcome JSONB NOT NULL CHECK (
        jsonb_typeof(outcome) = 'object' AND octet_length(outcome::text) <= 65536
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id, consent_incarnation, request_id),
    FOREIGN KEY (user_id, team_id) REFERENCES team_user(user_id, team_id) ON DELETE CASCADE
);
CREATE INDEX crm_email_policy_idempotency_link ON crm_email_policy_idempotency(link_id);

-- One replaceable count-preview slot per member bounds retained job state.
-- A new preview_id invalidates completion of the previous slot occupant.
CREATE TABLE crm_email_policy_previews (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    preview_id UUID NOT NULL,
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    consent_incarnation UUID NOT NULL,
    policy_version BIGINT NOT NULL CHECK (policy_version >= 0),
    context_id UUID NOT NULL,
    definition JSONB NOT NULL CHECK (
        jsonb_typeof(definition) = 'object' AND octet_length(definition::text) <= 65536
    ),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'running', 'complete', 'partial', 'cancelled', 'stale')
    ),
    counts JSONB NOT NULL DEFAULT '{}' CHECK (
        jsonb_typeof(counts) = 'object' AND octet_length(counts::text) <= 1024
    ),
    after_thread_id UUID,
    scanned_threads BIGINT NOT NULL DEFAULT 0 CHECK (scanned_threads >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (user_id, team_id) REFERENCES team_user(user_id, team_id) ON DELETE CASCADE,
    CHECK (expires_at > created_at)
);
CREATE INDEX crm_email_policy_previews_link ON crm_email_policy_previews(link_id);

-- One coalesced historical scan per member. work_id distinguishes replacement
-- requests even within the same consent generation (for example a live edit).
-- No worker consumes this table until the following rollout stage.
CREATE TABLE crm_email_policy_work (
    team_id UUID NOT NULL,
    user_id TEXT NOT NULL,
    work_id UUID NOT NULL,
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    consent_incarnation UUID NOT NULL,
    policy_version BIGINT NOT NULL CHECK (policy_version >= 0),
    after_thread_id UUID,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    traceparent TEXT,
    PRIMARY KEY (team_id, user_id),
    FOREIGN KEY (user_id, team_id) REFERENCES team_user(user_id, team_id) ON DELETE CASCADE
);
CREATE INDEX crm_email_policy_work_link ON crm_email_policy_work(link_id);

-- Source deletion must still be reconciled, so source_id deliberately has no
-- entity FK. A source edit records one event, not one row per referencing member.
-- The worker pages raw revision references before checking current consent.
CREATE TABLE crm_email_policy_source_events (
    event_id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    source_kind TEXT NOT NULL CHECK (source_kind IN ('contact', 'company')),
    source_id UUID NOT NULL,
    after_user_id TEXT,
    after_revision BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    traceparent TEXT,
    CHECK (num_nonnulls(after_user_id, after_revision) IN (0, 2)),
    CHECK (after_revision IS NULL OR after_revision > 0)
);
CREATE INDEX crm_email_policy_source_events_team ON crm_email_policy_source_events(team_id);
