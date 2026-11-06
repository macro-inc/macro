-- Reviews can be presented directly by any authenticated agent session.
SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_session_review ALTER COLUMN execution_id DROP NOT NULL;
