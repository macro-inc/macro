-- Add migration script here
CREATE TABLE public.github_pr_tasks
(
    id                 UUID                     NOT NULL,
    github_key         TEXT                     NOT NULL, -- organization:repo_name:pr_number
    task_id            TEXT                     NOT NULL, -- the short id of the macro task
    created_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at         TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,

    CONSTRAINT github_pr_tasks_pkey PRIMARY KEY (id),
    CONSTRAINT github_pr_tasks_github_key_task_id_unique UNIQUE (github_key, task_id)
);

-- Lookup indices
CREATE INDEX idx_github_pr_tasks_github_key
    ON public.github_pr_tasks (github_key);

CREATE INDEX idx_github_pr_tasks_task_id
    ON public.github_pr_tasks (task_id);
