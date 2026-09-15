-- The latest captured changeset of an agent session, and how the latest
-- capture attempt went (see agent_changes::domain::model).
--
-- One row per session, replaced on every capture: the Changes pane shows the
-- current state of the agent's branch, not a history of captures. The patch
-- itself is a blob under `patch_blob_key`; this row holds what the pane needs
-- before the patch arrives - the file list with statuses and line counts - so
-- the tree and headers render at once and the patch streams in behind them.
--
-- The summary columns are all NULL until a first capture succeeds, and a
-- failed attempt leaves the previous summary in place: a branch the provider
-- could not compare for a moment is still the branch it was. Cascade: a
-- session's changes go with the session; the orphaned patch blob is reclaimed
-- by the bucket's lifecycle rule rather than a delete here.
CREATE TABLE agent_session_changes (
    agent_session_id UUID PRIMARY KEY REFERENCES agent_session(id) ON DELETE CASCADE,
    -- Identity of the capture the summary columns describe (UUIDv7, minted
    -- in application code).
    changeset_id UUID,
    source TEXT CHECK (source IN ('cursor_github_compare', 'macrod_git', 'sandbox_git')),
    -- `https://github.com/owner/name` when the extractor knows it.
    repository TEXT,
    base_ref TEXT,
    base_sha TEXT,
    head_ref TEXT,
    head_sha TEXT,
    -- agent_changes::domain::model::ChangedFile, one per changed file, in
    -- patch order.
    files JSONB NOT NULL DEFAULT '[]'::jsonb,
    additions INTEGER NOT NULL DEFAULT 0,
    deletions INTEGER NOT NULL DEFAULT 0,
    patch_blob_key TEXT,
    patch_bytes BIGINT NOT NULL DEFAULT 0,
    truncated BOOLEAN NOT NULL DEFAULT false,
    captured_at TIMESTAMPTZ,
    -- The latest attempt: running while attempt_finished_at is NULL.
    attempt_started_at TIMESTAMPTZ NOT NULL,
    attempt_finished_at TIMESTAMPTZ,
    attempt_outcome TEXT CHECK (attempt_outcome IN ('captured', 'unsupported', 'not_ready', 'failed')),
    attempt_error TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT agent_session_changes_summary_complete CHECK (
        (changeset_id IS NULL) = (source IS NULL)
        AND (changeset_id IS NULL) = (captured_at IS NULL)
    ),
    CONSTRAINT agent_session_changes_attempt_complete CHECK (
        (attempt_finished_at IS NULL) = (attempt_outcome IS NULL)
    )
);
