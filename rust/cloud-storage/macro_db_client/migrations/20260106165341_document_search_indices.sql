-- Creates necessary document indices to improve the performance of name search

-- Enable trigram extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index allows efficient partial string matching
CREATE INDEX IF NOT EXISTS idx_document_name_trgm
    ON "Document" USING gin (name gin_trgm_ops);
