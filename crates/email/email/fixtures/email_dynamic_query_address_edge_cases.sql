-- Extra rows on top of `email_dynamic_query` for address-filter edge cases.
-- Loaded only by tests that need them; existing tests aren't affected.

-- Add bob@example.com as BCC on message 4 so the BCC filter has data to
-- match against. Message 4 is on thread 4 (alice → john) in the base
-- fixture — the BCC test will assert that filtering by Bcc(bob) returns
-- thread 4.
INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES
    ('30000004-0000-0000-0000-000000000004', '40000003-0000-0000-0000-000000000003', 'BCC');

-- Thread 12: a "split" thread that exercises single-message AND semantics.
--   msg12a: john → bob (john is sender; alice is NOT involved)
--   msg12b: bob → alice (alice is recipient; john is NOT the sender)
-- Filtering by `Sender(john) AND Recipient(alice)` must EXCLUDE this thread
-- because no single message in it satisfies both conjuncts. Filtering by
-- `Sender(john)` alone must INCLUDE it (proves the fixture is wired right).
--
-- inbox_visible=false so this thread doesn't show up in any of the existing
-- inbox/important tests that count threads exactly.
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at
)
VALUES
    ('20000012-0000-0000-0000-000000000012', 'thread12', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
     false, false, NULL, NULL, '2024-01-04 00:00:00+00', NOW(), NOW());

INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    -- msg12a: from john (40000001) — no alice on it
    ('30000012-0000-0000-0000-000000000012', '20000012-0000-0000-0000-000000000012',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg12a', '40000001-0000-0000-0000-000000000001',
     'Split Thread Part 1', 'john writing to bob', '2024-01-04 00:00:00+00',
     false, false, false, false, NOW(), NOW()),
    -- msg12b: from bob (40000003) — no john on it
    ('30000013-0000-0000-0000-000000000013', '20000012-0000-0000-0000-000000000012',
     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'msg12b', '40000003-0000-0000-0000-000000000003',
     'Split Thread Part 2', 'bob writing to alice', '2024-01-04 00:01:00+00',
     false, false, false, false, NOW(), NOW());

INSERT INTO email_message_recipients (message_id, contact_id, recipient_type)
VALUES
    -- msg12a: TO bob
    ('30000012-0000-0000-0000-000000000012', '40000003-0000-0000-0000-000000000003', 'TO'),
    -- msg12b: TO alice
    ('30000013-0000-0000-0000-000000000013', '40000004-0000-0000-0000-000000000004', 'TO');
