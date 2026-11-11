-- Give the layered mailbox cases their own reserved-domain owner.
INSERT INTO macro_user (id, username, email, stripe_customer_id)
VALUES ('0e000000-0000-0000-0000-000000000001', 'mail@example.com', 'mail@example.com', 'stripe_all_mail');
INSERT INTO "User" (id, email, name, macro_user_id)
VALUES ('macro|mail@example.com', 'mail@example.com', 'Mail Fixture', '0e000000-0000-0000-0000-000000000001');
UPDATE email_links SET macro_id = 'macro|mail@example.com'
WHERE id IN ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '0a000000-0000-0000-0000-000000000001');

-- Layered on email_dynamic_query and email_outlook_threads. Deliberately retain
-- stale thread timestamps for excluded messages to exercise pre-LIMIT filtering.
INSERT INTO email_labels (id, link_id, provider_label_id, name, type)
VALUES ('10000012-0000-0000-0000-000000000012', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'SPAM', 'SPAM', 'System');

INSERT INTO email_threads (id, provider_id, link_id, inbox_visible, is_read, latest_non_spam_message_ts)
SELECT ('0b000000-0000-0000-0000-' || lpad((provider * 100 + n)::text, 12, '0'))::uuid,
    'all-mail-' || provider || '-' || n, link_id, false, true,
    '2025-06-01T00:00:00Z'::timestamptz + (n - 1) * interval '1 day'
FROM (VALUES (1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
             (2, '0a000000-0000-0000-0000-000000000001'::uuid)) links(provider, link_id)
CROSS JOIN generate_series(1, 4) n;

INSERT INTO email_messages (id, thread_id, link_id, provider_id, subject, internal_date_ts, mailbox_state)
SELECT ('0c000000-0000-0000-0000-' || lpad((provider * 100 + n)::text, 12, '0'))::uuid,
    ('0b000000-0000-0000-0000-' || lpad((provider * 100 + least(n, 4))::text, 12, '0'))::uuid,
    link_id, 'all-mail-message-' || provider || '-' || n,
    CASE n WHEN 1 THEN 'Archived mail' WHEN 2 THEN 'Mixed normal mail'
           WHEN 3 THEN 'Trash only' ELSE 'Spam only' END,
    '2025-06-01T00:00:00Z'::timestamptz + (n - 1) * interval '1 day',
    CASE WHEN provider = 2 THEN jsonb_build_object('in_trash', n = 3, 'in_junk', n = 4) END
FROM (VALUES (1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
             (2, '0a000000-0000-0000-0000-000000000001'::uuid)) links(provider, link_id)
CROSS JOIN generate_series(1, 4) n;

INSERT INTO email_messages (id, thread_id, link_id, provider_id, subject, internal_date_ts, mailbox_state)
SELECT ('0c000000-0000-0000-0000-' || lpad((provider * 100 + n)::text, 12, '0'))::uuid,
    ('0b000000-0000-0000-0000-' || lpad((provider * 100 + 2)::text, 12, '0'))::uuid,
    link_id, 'all-mail-message-' || provider || '-' || n,
    CASE n WHEN 5 THEN 'Newer spam' ELSE 'Newest trash' END,
    '2025-06-01T00:00:00Z'::timestamptz + (n - 1) * interval '1 day',
    CASE WHEN provider = 2 THEN jsonb_build_object('in_trash', n = 6, 'in_junk', n = 5) END
FROM (VALUES (1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid),
             (2, '0a000000-0000-0000-0000-000000000001'::uuid)) links(provider, link_id)
CROSS JOIN generate_series(5, 6) n;

INSERT INTO email_message_labels (message_id, label_id) VALUES
    ('0c000000-0000-0000-0000-000000000103', '10000006-0000-0000-0000-000000000006'),
    ('0c000000-0000-0000-0000-000000000104', '10000012-0000-0000-0000-000000000012'),
    ('0c000000-0000-0000-0000-000000000105', '10000012-0000-0000-0000-000000000012'),
    ('0c000000-0000-0000-0000-000000000106', '10000006-0000-0000-0000-000000000006');

-- The base Outlook fixture predates denormalized timestamps. Keep its normal
-- messages ordered by their actual date, below the scenarios above.
UPDATE email_threads SET latest_non_spam_message_ts = '2025-01-01T11:00:00Z'
WHERE id IN ('0a000000-0000-0000-0000-0000000000a1', '0a000000-0000-0000-0000-0000000000a2');
