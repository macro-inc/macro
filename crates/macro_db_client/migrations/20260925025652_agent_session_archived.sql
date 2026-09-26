ALTER TABLE agent_session
ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN agent_session.is_archived IS
    'Whether the session is read-only and hidden from the active conversations list';
