-- Required values are enforced by the Rust database engine. Existing columns remain optional.
ALTER TABLE database_columns ADD COLUMN nullable BOOLEAN NOT NULL DEFAULT true;
