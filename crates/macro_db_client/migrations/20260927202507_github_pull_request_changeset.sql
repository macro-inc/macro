-- A GitHub pull request's changes at one base and head: the per-file summary a review
-- shows first, and where the patch is stored in S3. The id is derived from the repository,
-- number, and both commits, so the same range is stored once however many users, teams, or
-- agent sessions read it. The patch object may expire; it is re-read from GitHub on demand.
CREATE TABLE github_pull_request_changeset (
    id             UUID PRIMARY KEY,
    github_key     TEXT        NOT NULL,
    -- `https://github.com/owner/name`
    repository     TEXT        NOT NULL,
    number         BIGINT      NOT NULL,
    base_ref       TEXT,
    base_sha       TEXT        NOT NULL,
    head_ref       TEXT,
    head_sha       TEXT        NOT NULL,
    -- git_patch::ChangedFile, one per changed file, in patch order.
    files          JSONB       NOT NULL DEFAULT '[]'::jsonb,
    additions      INTEGER     NOT NULL DEFAULT 0,
    deletions      INTEGER     NOT NULL DEFAULT 0,
    -- NULL when nothing changed.
    patch_blob_key TEXT,
    patch_bytes    BIGINT      NOT NULL DEFAULT 0,
    truncated      BOOLEAN     NOT NULL DEFAULT false,
    captured_at    TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_github_pull_request_changeset_github_key
    ON github_pull_request_changeset (github_key);
