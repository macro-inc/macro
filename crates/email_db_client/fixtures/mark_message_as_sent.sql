-- A Macro message already queued for sending: no provider delivery time yet.
-- The old draft/envelope timestamps must not determine its Sent recency.
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active)
VALUES ('019a0000-0000-7000-8000-000000000001', 'macro|sent-cache@example.com',
        '019a0000-0000-7000-8000-000000000001', 'sent-cache@example.com', 'GMAIL', true),
       ('019a0000-0000-7000-8000-000000000002', 'macro|other-inbox@example.com',
        '019a0000-0000-7000-8000-000000000002', 'other-inbox@example.com', 'GMAIL', true);

INSERT INTO email_contacts (id, link_id, email_address)
VALUES ('019a0000-0000-7000-8000-000000000301',
        '019a0000-0000-7000-8000-000000000001', 'sent-cache@example.com');

INSERT INTO email_threads (id, link_id, inbox_visible, is_read)
VALUES ('019a0000-0000-7000-8000-000000000101',
        '019a0000-0000-7000-8000-000000000001', false, true),
       ('019a0000-0000-7000-8000-000000000102',
        '019a0000-0000-7000-8000-000000000001', false, true);

INSERT INTO email_messages (
    id, thread_id, link_id, from_contact_id, subject, is_sent, is_draft,
    internal_date_ts, sent_at, created_at, updated_at
)
VALUES ('019a0000-0000-7000-8000-000000000201',
        '019a0000-0000-7000-8000-000000000101',
        '019a0000-0000-7000-8000-000000000001',
        '019a0000-0000-7000-8000-000000000301',
        'Sent without provider synchronization', false, false, NULL,
        '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z'),
       ('019a0000-0000-7000-8000-000000000202',
        '019a0000-0000-7000-8000-000000000102',
        '019a0000-0000-7000-8000-000000000001',
        '019a0000-0000-7000-8000-000000000301',
        'Already has a provider timestamp', false, false,
        '2025-01-01T12:00:00Z', '2025-01-01T12:00:00Z',
        '2024-12-01T00:00:00Z', '2024-12-01T00:00:00Z');
