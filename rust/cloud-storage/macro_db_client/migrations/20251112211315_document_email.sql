-- table for linking email attachment documents and their emails
CREATE TABLE "document_email"
(
    document_id      TEXT NOT NULL REFERENCES "Document" (id) ON DELETE CASCADE,
    email_attachment_id uuid NOT NULL REFERENCES email_attachments (id) ON DELETE CASCADE,
    PRIMARY KEY (document_id, email_attachment_id)
);

-- composite index already exists for querying on document_id due to primary key.
-- need separate index to query by email_attachment_id efficiently.
CREATE INDEX idx_document_email_attachment_id ON "document_email" (email_attachment_id);
