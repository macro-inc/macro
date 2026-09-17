-- Postgres cannot drop an enum value. Roll back the column only.
ALTER TABLE initiative
    DROP COLUMN IF EXISTS description_document_id;
