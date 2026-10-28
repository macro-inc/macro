-- Assignees, labels, and reviews for GitHub pull requests, so they can be filtered and faceted
-- like the other typed columns. Written by the github_pull_requests crate from the records'
-- metadata; rows written before these columns keep the defaults until their next write.
ALTER TABLE github_pull_request
    -- [{"githubUserId": "42", "login": "octocat"}]
    ADD COLUMN assignees       JSONB NOT NULL DEFAULT '[]',
    -- [{"name": "bug", "color": "d73a4a"}]
    ADD COLUMN labels          JSONB NOT NULL DEFAULT '[]',
    -- Each reviewer's latest submitted review:
    -- [{"reviewerGithubUserId": "42", "reviewerLogin": "octocat", "state": "approved"}]
    ADD COLUMN reviews         JSONB NOT NULL DEFAULT '[]',
    -- Derived from the reviews and the outstanding review requests.
    ADD COLUMN review_decision TEXT
        CHECK (review_decision IN ('approved', 'changes_requested', 'review_required'));

CREATE INDEX idx_github_pull_request_assignees ON github_pull_request USING GIN (assignees);
CREATE INDEX idx_github_pull_request_labels ON github_pull_request USING GIN (labels);
