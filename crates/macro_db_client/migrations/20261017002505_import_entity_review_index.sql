-- no-transaction
-- Backs the review_id foreign key: deleting a review (with its agent
-- session) clears referencing rows, which is a full scan without this index.
CREATE INDEX CONCURRENTLY IF NOT EXISTS import_entity_review_idx
    ON import_entity (review_id) WHERE review_id IS NOT NULL;
