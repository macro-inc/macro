SET LOCAL lock_timeout = '5s';

CREATE TABLE password_item_entities (
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    user_id TEXT NOT NULL,
    metadata JSONB NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    grants JSONB NOT NULL DEFAULT '[]'::jsonb,
    deleting BOOLEAN NOT NULL DEFAULT false,
    revision BIGINT NOT NULL DEFAULT 1,
    totp_key_id UUID,
    cleanup_due_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    PRIMARY KEY(team_id, id)
);
-- Creator lookup includes retained item fences.
CREATE INDEX password_item_entities_owner ON password_item_entities(user_id, team_id);
CREATE INDEX password_item_entities_grants ON password_item_entities USING gin(grants) WHERE deleted_at IS NULL;
CREATE INDEX password_item_entities_search ON password_item_entities(team_id, (lower(metadata->>'name'))) WHERE deleted_at IS NULL;
CREATE TABLE password_folders (
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    id UUID NOT NULL,
    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
    PRIMARY KEY(team_id, id)
);
CREATE TABLE password_activity (
    team_id UUID NOT NULL,
    item_id UUID NOT NULL,
    id UUID NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK(action IN ('create','update','delete','reveal','copy','share','totp_setup','totp_remove','totp_code')),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    trace_id TEXT NOT NULL,
    PRIMARY KEY(team_id, item_id, id),
    FOREIGN KEY(team_id,item_id) REFERENCES password_item_entities(team_id,id) ON DELETE CASCADE
);

-- Durable metadata-only intents reconcile an accepted provider write after a lost response.
CREATE TABLE password_write_intents (
    operation_id UUID PRIMARY KEY,
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    item_id UUID NOT NULL,
    record JSONB NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_write_intents_item ON password_write_intents(team_id,item_id);

-- Generations isolate delayed setup requests from replacements and removals.
CREATE TABLE password_totp_enrollments (
    team_id UUID NOT NULL,
    item_id UUID NOT NULL,
    key_id UUID NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('pending','active','retired')),
    cleanup_after TIMESTAMPTZ NOT NULL,
    cleanup_started_at TIMESTAMPTZ,
    erased_at TIMESTAMPTZ,
    PRIMARY KEY(team_id,key_id),
    FOREIGN KEY(team_id,item_id) REFERENCES password_item_entities(team_id,id) ON DELETE CASCADE
);
CREATE INDEX password_totp_enrollments_item ON password_totp_enrollments(team_id,item_id);
CREATE INDEX password_totp_enrollments_cleanup ON password_totp_enrollments(cleanup_after) WHERE state <> 'active';

-- Retain the closed identity after successful erasure so retries and delayed
-- senders cannot reopen a namespace whose team metadata has been removed.
CREATE TABLE password_team_lifecycle (
    team_id UUID PRIMARY KEY,
    closed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
