-- Each agent repo's push budget, a token bucket shared by every replica of
-- the service that serves the repo. NULL means a full bucket.
ALTER TABLE agent_repos
    ADD COLUMN push_tokens DOUBLE PRECISION,
    ADD COLUMN push_tokens_refilled_at TIMESTAMPTZ;
