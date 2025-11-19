-- removing ON DELETE CASCADE for the email_attachments id row
ALTER TABLE "document_email"
DROP CONSTRAINT document_email_email_attachment_id_fkey;

-- Add it back without ON DELETE CASCADE
ALTER TABLE "document_email"
    ADD CONSTRAINT document_email_email_attachment_id_fkey
        FOREIGN KEY (email_attachment_id)
            REFERENCES email_attachments (id);
