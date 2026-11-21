-- A code-mode credential can be revoked before it expires: a background
-- job's when it settles. Validation refuses a revoked correlation; it still
-- attributes past activity. A nullable column without a default is metadata
-- only, so this does not rewrite the table.
SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_correlations ADD COLUMN revoked_at TIMESTAMPTZ;
