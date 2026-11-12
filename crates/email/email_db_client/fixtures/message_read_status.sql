-- SQL fixture for message read-status update tests
-- Two links so cross-inbox scoping can be asserted. The second link deliberately
-- carries a fusionauth_user_id that differs from its macro_id, mirroring a shared
-- or delegated inbox.

------------------------------------------------------------
-- User Links
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000e11', 'macro|read_status_user@example.com', '00000000-0000-0000-0000-000000000e11',
        'read_status_user@example.com', 'GMAIL', true, NOW(), NOW());

-- Second link, owned by a different fusion user than its macro_id implies
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000e12', 'macro|shared_mailbox@example.com', '00000000-0000-0000-0000-0000000000ff',
        'shared_mailbox@example.com', 'GMAIL', true, NOW(), NOW());

------------------------------------------------------------
-- Contacts
------------------------------------------------------------

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ce011',
        '00000000-0000-0000-0000-000000000e11',
        'sender@example.com',
        NOW(), NOW());

INSERT INTO email_contacts (id, link_id, email_address, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000ce012',
        '00000000-0000-0000-0000-000000000e12',
        'sender@example.com',
        NOW(), NOW());

------------------------------------------------------------
-- Threads
------------------------------------------------------------

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e211',
        '00000000-0000-0000-0000-000000000e11',
        true, false, NOW(), NOW());

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e212',
        '00000000-0000-0000-0000-000000000e12',
        true, false, NOW(), NOW());

------------------------------------------------------------
-- Messages on link e11, both unread
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e611',
        '00000000-0000-0000-0000-00000000e211',
        '00000000-0000-0000-0000-000000000e11',
        'provider-msg-e611',
        FALSE,
        '00000000-0000-0000-0000-0000000ce011',
        '2025-01-05 10:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e612',
        '00000000-0000-0000-0000-00000000e211',
        '00000000-0000-0000-0000-000000000e11',
        'provider-msg-e612',
        FALSE,
        '00000000-0000-0000-0000-0000000ce011',
        '2025-01-05 11:00:00 +00:00',
        false, false, false, false, NOW(), NOW());

------------------------------------------------------------
-- Message on link e12, unread
------------------------------------------------------------

INSERT INTO email_messages (id, thread_id, link_id, provider_id, is_sent, from_contact_id, internal_date_ts,
                            has_attachments, is_read, is_starred, is_draft, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-00000000e613',
        '00000000-0000-0000-0000-00000000e212',
        '00000000-0000-0000-0000-000000000e12',
        'provider-msg-e613',
        FALSE,
        '00000000-0000-0000-0000-0000000ce012',
        '2025-01-05 12:00:00 +00:00',
        false, false, false, false, NOW(), NOW());
