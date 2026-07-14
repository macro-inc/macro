-- Creates necessary project indices to improve the performance of name search

-- Enable trigram extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index allows efficient partial string matching
CREATE INDEX IF NOT EXISTS idx_project_name_trgm
    ON "Project" USING gin (name gin_trgm_ops);
