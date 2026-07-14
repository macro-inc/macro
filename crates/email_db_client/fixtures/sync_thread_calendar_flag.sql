-- Fixture for the denormalized email_threads.has_calendar_attachment flag.
--
-- Thread 1 (flag=false): message b501 has an .ics attachment, message b502
--   has none — sync should set the flag true; deleting b501 should clear it.
-- Thread 2 (flag=true, stale on purpose): message b503 has only a PDF —
--   sync should clear the flag.
-- Thread 3 (flag=false): message b504 has no attachments — used by the
--   insert_attachments path test to add and then orphan-delete an .ics.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000b01', 'macro|calflag_user@example.com', '00000000-0000-0000-0000-000000000b01',
        'calflag_user@example.com', 'GMAIL', true, NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000cb001',
        '00000000-0000-0000-0000-000000000b01',
        'sender@example.com',
        NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, has_calendar_attachment, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000b201',
        '00000000-0000-0000-0000-000000000b01',
        true, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000b202',
        '00000000-0000-0000-0000-000000000b01',
        true, false, true, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000b203',
        '00000000-0000-0000-0000-000000000b01',
        true, false, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, global_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000b501',
        '00000000-0000-0000-0000-00000000b201',
        '00000000-0000-0000-0000-000000000b01',
        'provider-msg-b501', 'gid-b501', FALSE,
        '00000000-0000-0000-0000-0000000cb001',
        '2025-01-05 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000b502',
        '00000000-0000-0000-0000-00000000b201',
        '00000000-0000-0000-0000-000000000b01',
        'provider-msg-b502', 'gid-b502', FALSE,
        '00000000-0000-0000-0000-0000000cb001',
        '2025-01-06 10:00:00 +00:00',
        false, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000b503',
        '00000000-0000-0000-0000-00000000b202',
        '00000000-0000-0000-0000-000000000b01',
        'provider-msg-b503', 'gid-b503', FALSE,
        '00000000-0000-0000-0000-0000000cb001',
        '2025-01-07 10:00:00 +00:00',
        true, false, false, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-00000000b504',
        '00000000-0000-0000-0000-00000000b203',
        '00000000-0000-0000-0000-000000000b01',
        'provider-msg-b504', 'gid-b504', FALSE,
        '00000000-0000-0000-0000-0000000cb001',
        '2025-01-08 10:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

INSERT INTO email_attachments (id, message_id, provider_attachment_id, filename, mime_type, size_bytes, content_id, created_at)
VALUES ('00000000-0000-0000-0000-0000001ba001',
        '00000000-0000-0000-0000-00000000b501',
        'provider-att-b001', 'invite.ics', 'text/calendar', 1024, NULL, NOW()),
       ('00000000-0000-0000-0000-0000001ba002',
        '00000000-0000-0000-0000-00000000b503',
        'provider-att-b002', 'notes.pdf', 'application/pdf', 2048, NULL, NOW());
