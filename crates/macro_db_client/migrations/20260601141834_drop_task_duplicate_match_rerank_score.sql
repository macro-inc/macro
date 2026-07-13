-- The deterministic lexical rerank stage has been removed from task duplicate
-- detection: candidates are now gated by vector similarity and decided by the
-- LLM judge alone, so the rerank score is no longer produced or stored.
ALTER TABLE task_duplicate_match
    DROP COLUMN rerank_score;
