-- Scan only after the column migration commits and releases its lock.
ALTER TABLE import_entity VALIDATE CONSTRAINT import_entity_kind_check;

-- A cancelled CONCURRENTLY build leaves an INVALID index that the earlier
-- migrations' IF NOT EXISTS would silently keep; fail loudly instead.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_index
        JOIN pg_class ON pg_class.oid = pg_index.indexrelid
        WHERE pg_class.relname IN (
            'import_entity_team_object_key',
            'import_entity_parent_idx',
            'import_entity_review_idx'
        )
          AND NOT pg_index.indisvalid
    ) THEN
        RAISE EXCEPTION 'an import_entity index build did not finish; drop the INVALID index and re-run migrations';
    END IF;
END
$$;
