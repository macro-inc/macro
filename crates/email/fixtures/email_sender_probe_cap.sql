-- One sender has thirteen message rows across three threads. Eleven rows
-- belong to the oldest thread, so capping distinct threads instead of branch
-- rows can falsely select a sparse page and lose the two newer threads.
-- Loaded after either the Team or Owned reader's fixture.
CREATE TEMP TABLE sender_cap_link AS
SELECT id FROM email_links
WHERE email_address IN ('u0@gamma.test', 'u0@owned.test');

INSERT INTO email_contacts (id, link_id, email_address)
SELECT '01900000-0000-7000-8000-000000000001'::uuid, id, 'sender@probe.test'
FROM sender_cap_link;

INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_non_spam_message_ts, created_at, updated_at
)
SELECT md5('sender-cap-thread-' || n)::uuid, 'sender-cap-thread-' || n, id,
       true, false, '2026-07-01'::timestamptz + n * interval '1 day',
       '2026-07-01'::timestamptz + n * interval '1 day',
       '2026-07-01'::timestamptz + n * interval '1 day',
       '2026-07-01'::timestamptz + n * interval '1 day'
FROM sender_cap_link CROSS JOIN generate_series(1, 3) n;

INSERT INTO email_messages (
    id, provider_id, thread_id, link_id, sent_at, subject, snippet,
    from_contact_id, is_sent, is_draft, is_starred, is_read, global_id,
    created_at, updated_at
)
SELECT md5('sender-cap-message-' || n)::uuid, 'sender-cap-message-' || n,
       md5('sender-cap-thread-' || CASE WHEN n <= 11 THEN 1 ELSE n - 10 END)::uuid,
       id, '2026-07-01'::timestamptz + n * interval '1 minute',
       'Sender probe boundary', 'Message ' || n,
       '01900000-0000-7000-8000-000000000001'::uuid,
       false, false, false, false, '<sender-cap-' || n || '@probe.test>',
       '2026-07-01'::timestamptz + n * interval '1 minute',
       '2026-07-01'::timestamptz + n * interval '1 minute'
FROM sender_cap_link CROSS JOIN generate_series(1, 13) n;
