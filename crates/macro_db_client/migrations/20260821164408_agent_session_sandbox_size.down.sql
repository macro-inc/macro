DROP TABLE user_agent_sandbox_size;

ALTER TABLE agent_session
    DROP COLUMN sandbox_size;
