-- Denormalized display state for agent sessions in the unified list (soup).
--
-- title: the session title the agent reports through the ACP
--   `session_info_update` notification, projected here by the harness's live
--   log writer so a list row can render a name without folding the log.
-- pending_permission_count: how many `session/request_permission` requests
--   are outstanding, projected the same way; > 0 means the session is
--   waiting on a person.
-- pr_url: the pull request the session produced, when one is known. Written
--   by future PR-detection work; the column exists now so the wire DTO and
--   UI can already render it.
ALTER TABLE agent_session
    ADD COLUMN title TEXT,
    ADD COLUMN pending_permission_count INT NOT NULL DEFAULT 0,
    ADD COLUMN pr_url TEXT;

-- The soup leg lists a user's sessions newest-modified first with an
-- (owner_id, modified_at, id) keyset cursor.
CREATE INDEX agent_session_owner_modified_idx
    ON agent_session (owner_id, modified_at DESC, id DESC);
