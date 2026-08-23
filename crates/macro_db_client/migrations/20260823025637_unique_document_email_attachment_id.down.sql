DROP INDEX IF EXISTS document_email_attachment_id_uq;

CREATE INDEX idx_document_email_attachment_id
    ON document_email (email_attachment_id);
