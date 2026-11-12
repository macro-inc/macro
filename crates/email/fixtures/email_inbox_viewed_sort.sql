-- Two inboxes of one user for the inbox's viewed sorts. Thread ids are hashes,
-- so id order is unrelated to time order. Inbound times repeat in threes and
-- view times repeat every seven threads, in both inboxes, so pages break
-- inside ties. Every tenth thread is out of the inbox; some of those are
-- opened too.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider)
VALUES
    ('a4278000-0000-0000-0000-00000000000a', 'macro|viewed@example.com', 'viewed-user', 'viewed@example.com', 'GMAIL'),
    ('a4278000-0000-0000-0000-00000000000b', 'macro|viewed@example.com', 'viewed-user', 'viewed.alt@example.com', 'GMAIL');

INSERT INTO email_threads (id, link_id, inbox_visible, latest_inbound_message_ts, reminder_returned_at)
SELECT
    md5(links.id::text || n)::uuid,
    links.id,
    n % 10 <> 0,
    CASE
        -- No inbound mail: 37 came back from a reminder, 41 has nothing to sort by.
        WHEN n % 37 = 0 OR n % 41 = 0 THEN NULL
        ELSE '2024-03-01 00:00:00+00'::timestamptz - (n / 3) * interval '1 hour'
    END,
    CASE
        WHEN n % 37 = 0 THEN '2024-03-02 00:00:00+00'::timestamptz
        WHEN n % 29 = 0 THEN '2024-03-05 00:00:00+00'::timestamptz - n * interval '1 hour'
    END
FROM (
    VALUES
        ('a4278000-0000-0000-0000-00000000000a'::uuid, 200),
        ('a4278000-0000-0000-0000-00000000000b'::uuid, 120)
) AS links(id, thread_count)
CROSS JOIN LATERAL generate_series(1, links.thread_count) AS n;

INSERT INTO email_messages (id, thread_id, link_id, internal_date_ts, subject, snippet)
SELECT md5(t.id::text || 'message')::uuid, t.id, t.link_id, '2024-03-01 00:00:00+00', 'Subject', 'Snippet'
FROM email_threads t
WHERE t.link_id IN ('a4278000-0000-0000-0000-00000000000a', 'a4278000-0000-0000-0000-00000000000b');

-- The first inbox has opened every third thread, the second every other one.
INSERT INTO email_user_history (link_id, thread_id, created_at, updated_at)
SELECT links.id, md5(links.id::text || n)::uuid, viewed.at, viewed.at
FROM (
    VALUES
        ('a4278000-0000-0000-0000-00000000000a'::uuid, 200, 3),
        ('a4278000-0000-0000-0000-00000000000b'::uuid, 120, 2)
) AS links(id, thread_count, opened_every)
CROSS JOIN LATERAL generate_series(1, links.thread_count) AS n
CROSS JOIN LATERAL (
    SELECT '2024-06-01 00:00:00+00'::timestamptz + (n % 7) * interval '1 day' AS at
) AS viewed
WHERE n % links.opened_every = 0;
