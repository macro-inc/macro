-- Existing columns keep their explicitly selected type.
ALTER TABLE database_columns ADD COLUMN infer_type BOOLEAN NOT NULL DEFAULT FALSE;
