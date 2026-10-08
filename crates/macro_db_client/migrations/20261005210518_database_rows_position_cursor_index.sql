-- no-transaction
-- The table view's stable manual order, including a unique cursor tie-breaker.
-- An existing name must fail so an interrupted, invalid index is not accepted.
CREATE INDEX CONCURRENTLY idx_database_rows_position_cursor
    ON database_rows (table_id, position, id);
