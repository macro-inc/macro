-- Additive metadata: older writers omit these columns; rows fill on their next sync.
SET LOCAL lock_timeout = '5s';

ALTER TABLE github_pull_request
    ADD COLUMN github_created_at TIMESTAMPTZ,
    ADD COLUMN requested_reviewers JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN default_branch TEXT;
