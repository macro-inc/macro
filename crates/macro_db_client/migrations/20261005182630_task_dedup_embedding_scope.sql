-- Copy each task's owner and team onto its embedding rows so the duplicate search
-- can find the rows in scope through an index instead of joining every embedding
-- to "Document". The search still joins "Document" and team_task as the access
-- check, so a stale copy can only hide a task from the search, never expose one.

-- No query reads these: the search computes exact distances over the rows in
-- scope. Dropping them first also spares the backfill an HNSW insert per row.
DROP INDEX IF EXISTS task_duplicate_embedding_vector_idx;
DROP INDEX IF EXISTS task_duplicate_embedding_search_key;

ALTER TABLE task_duplicate_embedding
    ADD COLUMN owner TEXT,
    ADD COLUMN team_id UUID;

UPDATE task_duplicate_embedding e
SET owner = d.owner,
    team_id = tt.team_id
FROM "Document" d
LEFT JOIN team_task tt ON tt.document_id = d.id
WHERE d.id = e.document_id;

ALTER TABLE task_duplicate_embedding
    ALTER COLUMN owner SET NOT NULL;

-- Writers insert only the embedding columns; the copies are filled here. A task's
-- owner and team_task row are written with its "Document" row and never updated.
CREATE FUNCTION set_task_duplicate_embedding_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    SELECT d.owner, tt.team_id
    INTO NEW.owner, NEW.team_id
    FROM "Document" d
    LEFT JOIN team_task tt ON tt.document_id = d.id
    WHERE d.id = NEW.document_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_task_duplicate_embedding_scope
BEFORE INSERT ON task_duplicate_embedding
FOR EACH ROW
EXECUTE FUNCTION set_task_duplicate_embedding_scope();

CREATE INDEX task_duplicate_embedding_owner_idx
    ON task_duplicate_embedding (owner);

CREATE INDEX task_duplicate_embedding_team_id_idx
    ON task_duplicate_embedding (team_id)
    WHERE team_id IS NOT NULL;
