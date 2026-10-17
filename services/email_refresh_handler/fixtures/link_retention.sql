-- Links covering the retention policy (pause after 7 idle days, delete paused links after 30).
-- Activity is the later of last_active_at (app opened) and the last thread view.

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider,
                         is_sync_active, sync_paused_at, last_active_at, created_at)
VALUES
    -- 01: never viewed a thread, idle 40 days but still syncing: pause before deleting
    ('00000000-0000-0000-0000-000000000001', 'macro|unused@example.com', 'fa-01',
     'unused@example.com', 'GMAIL', true, NULL, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days'),
    -- 02: paused, last thread view 90 days ago, idle 100 days: delete as inactive
    ('00000000-0000-0000-0000-000000000002', 'macro|stale@example.com', 'fa-02',
     'stale@example.com', 'GMAIL', false, NOW() - INTERVAL '70 days', NOW() - INTERVAL '100 days', NOW() - INTERVAL '100 days'),
    -- 03: app idle 60 days but a thread viewed 5 days ago: keep syncing
    ('00000000-0000-0000-0000-000000000003', 'macro|reader@example.com', 'fa-03',
     'reader@example.com', 'GMAIL', true, NULL, NOW() - INTERVAL '60 days', NOW() - INTERVAL '60 days'),
    -- 04: idle 10 days, no thread views: pause
    ('00000000-0000-0000-0000-000000000004', 'macro|idle@example.com', 'fa-04',
     'idle@example.com', 'GMAIL', true, NULL, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days'),
    -- 05: internal @macro.com link idle 200 days: never paused or deleted
    ('00000000-0000-0000-0000-000000000005', 'internal@macro.com', 'fa-05',
     'internal@macro.com', 'GMAIL', true, NULL, NOW() - INTERVAL '200 days', NOW() - INTERVAL '200 days'),
    -- 06: app opened yesterday, last thread view 90 days ago: keep syncing
    ('00000000-0000-0000-0000-000000000006', 'macro|app-user@example.com', 'fa-06',
     'app-user@example.com', 'GMAIL', true, NULL, NOW() - INTERVAL '1 day', NOW() - INTERVAL '120 days'),
    -- 07: already paused, idle 12 days: neither paused again nor deleted yet
    ('00000000-0000-0000-0000-000000000007', 'macro|paused@example.com', 'fa-07',
     'paused@example.com', 'GMAIL', false, NOW() - INTERVAL '5 days', NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 days'),
    -- 08: paused 25 days ago, idle 32 days: delete as unused
    ('00000000-0000-0000-0000-000000000008', 'macro|expired@example.com', 'fa-08',
     'expired@example.com', 'GMAIL', false, NOW() - INTERVAL '25 days', NOW() - INTERVAL '32 days', NOW() - INTERVAL '32 days'),
    -- 09: last thread view 9 days ago, app idle 20 days: pause
    ('00000000-0000-0000-0000-000000000009', 'macro|lapsed@example.com', 'fa-09',
     'lapsed@example.com', 'GMAIL', true, NULL, NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days');

INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000b0002', '00000000-0000-0000-0000-000000000002', true, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000b0003', '00000000-0000-0000-0000-000000000003', true, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000b0006', '00000000-0000-0000-0000-000000000006', true, false, NOW(), NOW()),
       ('00000000-0000-0000-0000-0000000b0009', '00000000-0000-0000-0000-000000000009', true, false, NOW(), NOW());

INSERT INTO email_user_history (link_id, thread_id, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000b0002',
        NOW() - INTERVAL '90 days', NOW() - INTERVAL '90 days'),
       ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000b0003',
        NOW() - INTERVAL '60 days', NOW() - INTERVAL '5 days'),
       ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000b0006',
        NOW() - INTERVAL '90 days', NOW() - INTERVAL '90 days'),
       ('00000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-0000000b0009',
        NOW() - INTERVAL '9 days', NOW() - INTERVAL '9 days');
