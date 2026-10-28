-- Typed columns for GitHub pull requests, so pull requests can be filtered and sorted without
-- reading JSON metadata. One row per pull request, shared by every foreign entity record stored
-- for it: a record joins its row on its owner/repo/pull/number key. Written by the
-- github_pull_requests crate from the records' metadata.
--
-- The repository's numeric id and the pull request number identify a pull request across
-- repository renames and transfers. The id is filled in once it is known.
CREATE TABLE github_pull_request (
    github_key                         TEXT PRIMARY KEY,
    repository_id                      BIGINT,
    number                             BIGINT NOT NULL,
    owner                              TEXT NOT NULL,
    repo                               TEXT NOT NULL,
    title                              TEXT,
    status                             TEXT CHECK (status IN ('open', 'closed', 'merged')),
    draft                              BOOLEAN NOT NULL DEFAULT FALSE,
    author_github_user_id              TEXT,
    author_login                       TEXT,
    requested_reviewer_github_user_ids TEXT[] NOT NULL DEFAULT '{}',
    participant_github_user_ids        TEXT[] NOT NULL DEFAULT '{}',
    github_updated_at                  TIMESTAMPTZ,
    created_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_github_pull_request_repository_number UNIQUE (repository_id, number)
);

CREATE INDEX idx_github_pull_request_author ON github_pull_request (author_github_user_id);
CREATE INDEX idx_github_pull_request_github_updated_at ON github_pull_request (github_updated_at DESC);
CREATE INDEX idx_github_pull_request_requested_reviewers
    ON github_pull_request USING GIN (requested_reviewer_github_user_ids);
CREATE INDEX idx_github_pull_request_participants
    ON github_pull_request USING GIN (participant_github_user_ids);
