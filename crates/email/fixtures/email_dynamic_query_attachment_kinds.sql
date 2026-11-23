-- Attachment kind fixture. Layers on top of `email_dynamic_query` and
-- `email_dynamic_query_calendar`, which attaches PDFs to threads 5 and 7.
-- Adds an image to thread 3 and a .docx to thread 6. Tests sync the thread
-- flags through email_db_client, as ingest does.

INSERT INTO email_attachments (id, message_id, filename, mime_type, created_at)
VALUES
    ('90000003-0000-0000-0000-0000000000a3', '30000003-0000-0000-0000-000000000003',
     'photo.jpg', 'image/jpeg', NOW()),
    ('90000006-0000-0000-0000-0000000000a6', '30000006-0000-0000-0000-000000000006',
     'plan.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', NOW());
