-- The repository a session works against becomes optional: external
-- runtimes own their workspace contents, and stating the repo is a courtesy
-- they may skip. Managed sessions keep stamping theirs.
ALTER TABLE agent_session
    ALTER COLUMN repo_url DROP NOT NULL;
