-- no-transaction
CREATE INDEX CONCURRENTLY IF NOT EXISTS import_entity_notion_review_sources_idx
    ON import_entity (review_id, user_id)
    WHERE review_id IS NOT NULL
      AND source = 'notion'
      AND kind = 'data_source'
      AND status = 'staged';
