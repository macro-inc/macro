-- no-transaction
-- Lets the flat Soup query read a project page's most recently updated rows
-- past its cursor, ordered by ("updatedAt" DESC, id DESC), from the index alone.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_updated_at_id
    ON "Project" ("updatedAt", id);
