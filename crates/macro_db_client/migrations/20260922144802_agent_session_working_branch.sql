-- Runtime-reported working branch. The selected repo_branch is only a starting point.
ALTER TABLE agent_session ADD COLUMN working_branch TEXT;
