-- The link to each description document is gone; restore the column empty.
ALTER TABLE initiative
    ADD COLUMN IF NOT EXISTS description_document_id TEXT
        UNIQUE
        REFERENCES "Document" (id) ON DELETE RESTRICT;
