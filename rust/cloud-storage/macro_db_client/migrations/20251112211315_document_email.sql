-- table for linking email attachment documents and their emails
CREATE TABLE "DocumentEmail"
(
    document_id      TEXT NOT NULL REFERENCES "Document" (id) ON DELETE CASCADE,
    email_message_id uuid NOT NULL REFERENCES email_messages (id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, email_message_id)
);

-- composite index already exists for querying on document_id due to primary key.
-- need separate index to query by email_message_id efficiently.
CREATE INDEX idx_document_email_message_id ON "DocumentEmail" (email_message_id);
