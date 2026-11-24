-- The table version up to which the `database_rows` search index holds each
-- table's rows, owned by `search_processing_service` through
-- `crates/database_row_search`. The indexer raises it only after every write
-- for those versions succeeded, so a failed pass is redone from the old mark.
--
-- No foreign keys: a table's mark outlives the table until the indexer has
-- removed its rows from the index, then the indexer deletes the mark. A
-- missing mark means "unknown", which makes the next pass reindex the table
-- whole.
CREATE TABLE database_row_search_watermarks (
    table_id UUID PRIMARY KEY,
    database_id UUID NOT NULL,
    indexed_version BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves dropping every mark of a trashed or purged database.
CREATE INDEX idx_database_row_search_watermarks_database
    ON database_row_search_watermarks (database_id);
