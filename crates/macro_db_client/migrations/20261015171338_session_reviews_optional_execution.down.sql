-- Refuse rollback when standalone reviews exist rather than deleting user data.
SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_session_review ALTER COLUMN execution_id SET NOT NULL;
