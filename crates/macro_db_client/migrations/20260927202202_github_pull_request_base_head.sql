-- The branches and commits a GitHub pull request compares, kept current by pull request
-- webhooks, so its changes can be looked up by base and head without asking GitHub.
ALTER TABLE github_pull_request
    ADD COLUMN base_ref TEXT,
    ADD COLUMN base_sha TEXT,
    ADD COLUMN head_ref TEXT,
    ADD COLUMN head_sha TEXT;
