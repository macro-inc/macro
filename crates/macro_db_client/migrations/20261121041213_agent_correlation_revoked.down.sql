SET LOCAL lock_timeout = '5s';
ALTER TABLE agent_correlations DROP COLUMN revoked_at;
