-- New metadata is nullable for existing writers and historical activity.
SET lock_timeout = '5s';
CREATE TABLE agent_correlations (
    id uuid PRIMARY KEY,
    agent_session_id uuid NOT NULL REFERENCES agent_session(id) ON DELETE CASCADE
);
CREATE INDEX agent_correlations_session_idx ON agent_correlations(agent_session_id, id);
ALTER TABLE activity_events ADD COLUMN agent_correlation_id uuid;
-- Deliberately no activity FK: deleting a session removes its mappings without
-- deleting or rewriting the affected entities' existing activity history.
