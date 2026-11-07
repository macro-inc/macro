-- Fixture for the denormalized PDF / image / document thread flags.
--
-- Thread c201 (flags false): message c501 has a PDF and a PNG, message c502 a
--   .docx — sync sets all three; deleting c501 leaves only the document flag.
-- Thread c202 (flags true, stale on purpose): no attachments — sync clears
--   them; the backfill, which only sets flags, leaves them.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000c01', 'macro|kindflag_user@example.com', '00000000-0000-0000-0000-000000000c01',
        'kindflag_user@example.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cc001', '00000000-0000-0000-0000-000000000c01',
        'sender@example.com', NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read,
                           has_pdf_attachment, has_image_attachment, has_document_attachment,
                           created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c201', '00000000-0000-0000-0000-000000000c01',
        true, false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000c202', '00000000-0000-0000-0000-000000000c01',
        true, false, true, true, true, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, global_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000c501', '00000000-0000-0000-0000-00000000c201',
        '00000000-0000-0000-0000-000000000c01', 'provider-msg-c501', 'gid-c501', FALSE,
        '00000000-0000-0000-0000-0000000cc001', '2025-01-05 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000c502', '00000000-0000-0000-0000-00000000c201',
        '00000000-0000-0000-0000-000000000c01', 'provider-msg-c502', 'gid-c502', FALSE,
        '00000000-0000-0000-0000-0000000cc001', '2025-01-06 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000c503', '00000000-0000-0000-0000-00000000c202',
        '00000000-0000-0000-0000-000000000c01', 'provider-msg-c503', 'gid-c503', FALSE,
        '00000000-0000-0000-0000-0000000cc001', '2025-01-07 10:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001ca001', '00000000-0000-0000-0000-00000000c501',
        'provider-att-c001', 'deck.pdf', 'application/pdf', 1024, NULL, NOW()),
       ('00000000-0000-0000-0000-0000001ca002', '00000000-0000-0000-0000-00000000c501',
        'provider-att-c002', 'logo.png', 'image/png', 512, 'logo@cid', NOW()),
       ('00000000-0000-0000-0000-0000001ca003', '00000000-0000-0000-0000-00000000c502',
        'provider-att-c003', 'notes.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 2048, NULL, NOW());
