CREATE TABLE team_task_counter (
    team_id UUID PRIMARY KEY REFERENCES team(id) ON DELETE CASCADE,
    last_task_num INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT team_task_counter_positive CHECK (last_task_num >= 0)
);

CREATE TABLE team_task (
    team_id UUID NOT NULL REFERENCES team(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES "Document"(id) ON DELETE CASCADE,
    task_num INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (team_id, task_num),
    CONSTRAINT team_task_document_unique UNIQUE (document_id),
    CONSTRAINT team_task_num_positive CHECK (task_num > 0)
);

CREATE INDEX team_task_document_id_idx ON team_task(document_id);

-- Backfill existing task documents only when the owner's team is deterministic.
WITH deterministic_task_team AS (
    SELECT
        d.id AS document_id,
        tu.team_id,
        d."createdAt",
        COUNT(*) OVER (PARTITION BY d.id) AS team_count
    FROM "Document" d
    JOIN document_sub_type dst ON dst.document_id = d.id
    JOIN team_user tu ON tu.user_id = d.owner
    WHERE dst.sub_type = 'task'
), numbered AS (
    SELECT
        team_id,
        document_id,
        ROW_NUMBER() OVER (
            PARTITION BY team_id
            ORDER BY "createdAt", document_id
        )::int AS task_num
    FROM deterministic_task_team
    WHERE team_count = 1
)
INSERT INTO team_task (team_id, document_id, task_num)
SELECT team_id, document_id, task_num
FROM numbered
ON CONFLICT DO NOTHING;

INSERT INTO team_task_counter (team_id, last_task_num)
SELECT team_id, MAX(task_num)
FROM team_task
GROUP BY team_id
ON CONFLICT (team_id) DO UPDATE
SET last_task_num = EXCLUDED.last_task_num,
    updated_at = NOW();
