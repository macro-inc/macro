-- A routine draft in progress, keyed by the hidden agent session drafting it. The session
-- hands its routine back by checking it (POST /scheduled-actions/check), which keeps the
-- latest check here; the drafter, on any replica, reads it and deletes the row. Rows are
-- deleted when the draft returns, and a sweep deletes any a stopped process left. No
-- foreign key: the session is deleted first.
CREATE TABLE scheduled_action_draft (
    session_id UUID PRIMARY KEY,
    owner_id   TEXT NOT NULL,
    bot_id     UUID NOT NULL,
    checked    JSONB,
    -- The latest check that passed; the draft prefers it to a later failing one.
    passed     JSONB,
    checks     INTEGER NOT NULL DEFAULT 0,
    -- What the session said it created for the routine to use, as {entityType, entityId}.
    created    JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX scheduled_action_draft_created_at ON scheduled_action_draft (created_at);
