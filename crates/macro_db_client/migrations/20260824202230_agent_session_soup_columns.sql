-- Denormalized display state for agent sessions in the unified list (Soup).
--
-- `title` is the session title the runtime reports through the log pipeline
-- (ACP `session_info_update`); NULL until one is reported, and the client
-- falls back to the harness name.
--
-- `pending_permission_count` counts the session's outstanding
-- `session/request_permission` requests, maintained by the log projection the
-- same way `status` is. It drives the "Needs approval" badge and grouping
-- without folding the whole log per row.
--
-- `pr_url` is the pull request a session produced, when one was detected.
-- Populated by future work (PR detection in the coding agent worker); the
-- column exists now so the row DTO and UI can already render it.
ALTER TABLE agent_session
    ADD COLUMN title TEXT,
    ADD COLUMN pending_permission_count INT NOT NULL DEFAULT 0,
    ADD COLUMN pr_url TEXT;

-- The unified list pages sessions by recency for one owner.
CREATE INDEX agent_session_owner_modified_idx
    ON agent_session (owner_id, modified_at DESC, id DESC);
