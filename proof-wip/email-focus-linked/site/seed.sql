-- Production-size seed for the three Focus inbox reads that now name the
-- users each inbox is linked to. Synthetic addresses only.
--
-- email_links       200,000 mailboxes (150,000 syncing): assumed above production
-- macro_user_links  160,500 edges: half the mailboxes linked to one user, a
--                   quarter to a second, one shared mailbox read by 500 users,
--                   and 10,000 edges whose primary is the mailbox's own owner
-- email_threads     2,050,000 (10 per mailbox, 50,000 in the big one)
-- email_thread_focus 70,000 rows: 10 in each of 5,000 mailboxes, half of them
--                   Focus, and 20,000 Focus rows in the big shared mailbox

SET session_replication_role = 'replica';

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active)
SELECT md5('link' || n)::uuid,
       'macro|u' || n || '@seed.example',
       'fa-' || n,
       'u' || n || '@seed.example',
       'GMAIL',
       n % 4 <> 0
FROM generate_series(1, 200000) n;

-- One linked user for every second mailbox.
INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
SELECT 'macro|p' || (n % 60000) || '@seed.example', 'macro|u' || n || '@seed.example', md5('link' || n)::uuid
FROM generate_series(2, 200000, 2) n;
-- A second one for every fourth.
INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
SELECT 'macro|q' || (n % 60000) || '@seed.example', 'macro|u' || n || '@seed.example', md5('link' || n)::uuid
FROM generate_series(4, 200000, 4) n;
-- The shared mailbox 1: 500 readers.
INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
SELECT 'macro|reader' || r || '@seed.example', 'macro|shared1@seed.example', md5('link1')::uuid
FROM generate_series(1, 500) r;
-- Edges naming the mailbox's own owner as primary, left by a rehome.
INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
SELECT 'macro|u' || n || '@seed.example', 'macro|old' || n || '@seed.example', md5('link' || n)::uuid
FROM generate_series(3, 30000, 3) n;

INSERT INTO email_threads (id, link_id, inbox_visible, is_signal, latest_inbound_message_ts)
SELECT md5('thread' || n)::uuid,
       md5('link' || (n % 200000 + 1))::uuid,
       n % 3 <> 0,
       n % 2 = 0,
       now() - (n % 1000) * interval '1 hour'
FROM generate_series(1, 2000000) n;
INSERT INTO email_threads (id, link_id, inbox_visible, is_signal, latest_inbound_message_ts)
SELECT md5('big' || n)::uuid, md5('link1')::uuid, true, true, now() - n * interval '1 minute'
FROM generate_series(1, 50000) n;

INSERT INTO email_thread_focus (
    thread_id, link_id, classified_message_id, classified_message_ts, is_focus, category,
    importance, needs_reply, needs_follow_up, scores, model, classified_at
)
SELECT md5('thread' || n)::uuid,
       md5('link' || (n % 200000 + 1))::uuid,
       md5('message' || n)::uuid,
       now(),
       n % 2 = 0,
       'other',
       50,
       false,
       false,
       '{}'::jsonb,
       'seed',
       now()
FROM generate_series(1, 2000000) n
WHERE n % 200000 + 1 <= 5000
;
INSERT INTO email_thread_focus (
    thread_id, link_id, classified_message_id, classified_message_ts, is_focus, category,
    importance, needs_reply, needs_follow_up, scores, model, classified_at
)
SELECT md5('big' || n)::uuid, md5('link1')::uuid, md5('bigmessage' || n)::uuid, now(), true,
       'other', 50, false, false, '{}'::jsonb, 'seed', now()
FROM generate_series(1, 20000) n;

SET session_replication_role = 'origin';
