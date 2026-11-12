SET LOCAL lock_timeout = '2s';

-- Agent access to vault items. Agent grants live in password_item_entities.grants;
-- this row holds one agent's standing approval, grant/approval revision and
-- latest access request for one item.
CREATE TABLE password_agent_access (
    team_id UUID NOT NULL,
    item_id UUID NOT NULL,
    agent_user_id TEXT NOT NULL,
    -- Human who granted standing approval; NULL means no approval.
    approved_by TEXT,
    permission_revision BIGINT NOT NULL DEFAULT 0 CHECK (permission_revision >= 0),
    request_id UUID,
    request_permission TEXT CHECK (request_permission IN ('view','edit')),
    request_status TEXT CHECK (request_status IN ('pending','approved','denied','revoked')),
    request_revision BIGINT NOT NULL DEFAULT 0 CHECK (request_revision >= 0),
    request_updated_at TIMESTAMPTZ,
    PRIMARY KEY (team_id, item_id, agent_user_id),
    FOREIGN KEY (team_id, item_id) REFERENCES password_item_entities(team_id, id) ON DELETE CASCADE,
    CHECK ((request_id IS NULL) = (request_status IS NULL)),
    CHECK ((request_id IS NULL) = (request_permission IS NULL)),
    CHECK ((request_id IS NULL) = (request_updated_at IS NULL))
);
CREATE UNIQUE INDEX password_agent_access_request ON password_agent_access(team_id, request_id)
    WHERE request_id IS NOT NULL;
-- Review lists walk a team's pending requests in request order.
CREATE INDEX password_agent_access_pending ON password_agent_access(team_id, request_id)
    WHERE request_status = 'pending';

-- Committed request transitions awaiting delivery: reviewer notifications for
-- new requests and resolution hints to the agent. They grant nothing. The item
-- name and reviewers are frozen at commit.
CREATE TABLE password_agent_access_events (
    id UUID PRIMARY KEY,
    team_id UUID NOT NULL,
    item_id UUID NOT NULL,
    agent_user_id TEXT NOT NULL,
    request_id UUID NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending','approved','denied','revoked')),
    item_name TEXT NOT NULL,
    reviewers JSONB NOT NULL DEFAULT '[]'::jsonb,
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    retry_after TIMESTAMPTZ NOT NULL DEFAULT '-infinity',
    delivered_at TIMESTAMPTZ,
    FOREIGN KEY (team_id, item_id) REFERENCES password_item_entities(team_id, id) ON DELETE CASCADE
);
CREATE INDEX password_agent_access_events_due ON password_agent_access_events(retry_after, id)
    WHERE delivered_at IS NULL;

-- Agent identity retained with a write intent or enrollment, so whichever
-- reconciler completes it records the agent's audit in the same transaction.
ALTER TABLE password_write_intents
    ADD COLUMN agent_user_id TEXT,
    ADD COLUMN wake_id UUID,
    ADD COLUMN agent_action TEXT CHECK (agent_action IN ('agent_create','agent_update')),
    ADD CHECK ((agent_user_id IS NULL) = (agent_action IS NULL));
ALTER TABLE password_totp_enrollments
    ADD COLUMN agent_user_id TEXT,
    ADD COLUMN wake_id UUID;

-- Agent audit shares the activity journal; human activity reads exclude these rows.
-- The widened action CHECK is validated by a later migration without blocking writes.
ALTER TABLE password_activity
    ADD COLUMN agent_user_id TEXT,
    ADD COLUMN wake_id UUID,
    ADD COLUMN permission_revision BIGINT,
    DROP CONSTRAINT password_activity_action_check,
    ADD CONSTRAINT password_activity_action_check CHECK (action IN (
        'create','update','delete','reveal','copy','share','totp_setup','totp_remove','totp_code',
        'agent_search_hit','agent_disclose','agent_totp_code','agent_create','agent_update',
        'agent_totp_setup','agent_access_request','agent_access_approve','agent_access_deny',
        'agent_access_revoke'
    )) NOT VALID;
