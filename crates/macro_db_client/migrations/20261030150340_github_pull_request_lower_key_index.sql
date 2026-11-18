-- no-transaction
-- Session pull request links match pull requests case-insensitively.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_github_pull_request_lower_github_key
    ON github_pull_request (lower(github_key));
