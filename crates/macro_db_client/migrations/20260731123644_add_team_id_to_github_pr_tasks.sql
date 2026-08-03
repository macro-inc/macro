-- Record which team's task a PR link belongs to, making github_pr_tasks rows
-- explicitly team-scoped. NULL for rows written before this column existed
-- (task_id is a base58 short UUID, so they cannot be joined to team_task in
-- SQL; upsert_task_ids backfills them as PR events recur) and for tasks that
-- have no team_task row.
ALTER TABLE github_pr_tasks
    ADD COLUMN team_id UUID REFERENCES team (id) ON DELETE SET NULL;

CREATE INDEX idx_github_pr_tasks_team_id ON github_pr_tasks (team_id);
