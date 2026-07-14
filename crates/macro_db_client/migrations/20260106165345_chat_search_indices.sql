-- Creates necessary chat indices to improve the performance of name search

-- Enable trigram extension for fuzzy text matching
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GIN trigram index allows efficient partial string matching
CREATE INDEX IF NOT EXISTS idx_chat_name_trgm
    ON "Chat" USING gin (name gin_trgm_ops);
