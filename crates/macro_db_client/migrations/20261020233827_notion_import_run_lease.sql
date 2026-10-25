-- A Notion workspace import survives the process that runs it.
--
-- The process planning or writing holds a lease on the run, renewed by its
-- heartbeat; when the lease lapses (crash, deploy) another process adopts the
-- run and resumes the job recorded on it: planning restarts with `scope`,
-- writing continues the plan tied to `review_id`. `root_folder_id` is the
-- user's "Notion" folder, reused by every import. `adoptions` counts how
-- often the run was picked up after its process stopped, so a job that
-- keeps killing its process is given up on.
--
-- `import_entity_written` is what a write already created for each ledger
-- row (its folder, document, database, rows, row bodies, tasks), so a
-- resumed write reuses them instead of creating them again.
--
-- Every new column is nullable or defaulted, so code deployed before this
-- change keeps working.
SET LOCAL lock_timeout = '5s';

ALTER TABLE import_run
    ADD COLUMN lease_owner UUID,
    ADD COLUMN lease_expires_at TIMESTAMPTZ,
    ADD COLUMN scope JSONB,
    ADD COLUMN review_id UUID REFERENCES agent_session_review (id) ON DELETE SET NULL,
    ADD COLUMN root_folder_id UUID,
    ADD COLUMN adoptions SMALLINT NOT NULL DEFAULT 0;

-- Removed with its ledger row, which a new plan or a user's cleanup deletes.
CREATE TABLE import_entity_written (
    import_id  UUID NOT NULL REFERENCES import_entity (id) ON DELETE CASCADE,
    -- 'folder' | 'document' | 'database' | 'table' | 'title_column' |
    -- 'schema' | 'row' | 'bodies_folder' | 'page_column' | 'body' |
    -- 'tasks_folder' | 'task' | 'relation' | 'relation_linked'
    kind       TEXT NOT NULL,
    -- The Notion row or property it is for; empty for the object itself.
    object     TEXT NOT NULL DEFAULT '',
    macro_id   UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (import_id, kind, object)
);
