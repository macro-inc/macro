-- A generic pipeline's Name is an ordinary column, so it can be deleted, leaving
-- primary_column_id naming no column. A tracked pipeline's record column stays:
-- ColumnProtection::Delete refuses deleting it in the domain and in the cell store.
-- No ON DELETE SET NULL: it would wait on the row lock the pipeline's write guard holds.
ALTER TABLE crm_pipeline_entities DROP CONSTRAINT crm_pipeline_entities_primary_column_id_fkey;
