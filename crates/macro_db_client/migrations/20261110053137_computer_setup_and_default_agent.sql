-- The guided setup after buying a computer: when the team finished it, and
-- the coding agent the computer came with, which that setup names. Bots are
-- soft-deleted, so `default_agent_id` can name a deleted agent; readers check.

SET LOCAL lock_timeout = '5s';

ALTER TABLE hosted_runtime
    ADD COLUMN setup_completed_at TIMESTAMPTZ,
    ADD COLUMN default_agent_id UUID REFERENCES bots (id) ON DELETE SET NULL;
