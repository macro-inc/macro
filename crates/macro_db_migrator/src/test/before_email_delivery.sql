-- Seed attachments before the manifest column and its insert trigger exist.
INSERT INTO email_attachments_drafts
    (id, draft_id, file_name, content_type, sha, size, s3_key)
VALUES ('f0000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-00000000e501',
        'uploaded.txt', 'text/plain', 'upgrade-upload', 3, 'upgrade-upload');

INSERT INTO email_attachments
    (id, message_id, provider_attachment_id, filename, mime_type, size_bytes)
VALUES ('f0000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-00000000e502',
        'upgrade-forward', 'forwarded.txt', 'text/plain', 3);

INSERT INTO email_attachments_fwd (message_id, attachment_id)
VALUES ('00000000-0000-0000-0000-00000000e501',
        'f0000000-0000-0000-0000-000000000001');
