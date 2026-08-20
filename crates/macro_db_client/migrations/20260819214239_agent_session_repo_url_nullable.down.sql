UPDATE agent_session SET repo_url = '' WHERE repo_url IS NULL;

ALTER TABLE agent_session
    ALTER COLUMN repo_url SET NOT NULL;
