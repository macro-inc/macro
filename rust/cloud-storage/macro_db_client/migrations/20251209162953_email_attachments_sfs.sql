CREATE TABLE "email_attachments_sfs"
(
    id UUID PRIMARY KEY,
    attachment_id UUID REFERENCES email_attachments (id) ON DELETE SET NULL,
    sfs_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_attachments_sfs_attachment_id ON email_attachments_sfs (attachment_id);