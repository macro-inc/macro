-- SQL fixture for fetch_inactive_link_ids tests
-- Tests the query that identifies links eligible for deletion

------------------------------------------------------------
-- Link 1: Old link with NO history (should be deleted - Condition A)
-- Created 40 days ago, no user_history entries
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'macro|unused_user@example.com', '00000000-0000-0000-0000-0000000a0001',
        'unused_user@example.com', 'GMAIL', true, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days');

-- Thread for link 1 (needed for FK but no history will reference it)
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000b0001', '00000000-0000-0000-0000-000000000001',
        true, false, NOW() - INTERVAL '40 days', NOW() - INTERVAL '40 days');

------------------------------------------------------------
-- Link 2: Link with STALE history (should be deleted - Condition B)
-- Has history, but last activity was 90 days ago
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000002', 'macro|stale_user@example.com', '00000000-0000-0000-0000-0000000a0002',
        'stale_user@example.com', 'GMAIL', true, NOW() - INTERVAL '100 days', NOW() - INTERVAL '90 days');

-- Thread for link 2
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000b0002', '00000000-0000-0000-0000-000000000002',
        true, false, NOW() - INTERVAL '100 days', NOW() - INTERVAL '90 days');

-- User history for link 2 (stale - 90 days old)
INSERT INTO email_user_history (link_id, thread_id, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000b0002',
        NOW() - INTERVAL '90 days', NOW() - INTERVAL '90 days');

------------------------------------------------------------
-- Link 3: ACTIVE link with recent history (should NOT be deleted)
-- Has history updated recently (5 days ago)
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000003', 'macro|active_user@example.com', '00000000-0000-0000-0000-0000000a0003',
        'active_user@example.com', 'GMAIL', true, NOW() - INTERVAL '60 days', NOW() - INTERVAL '5 days');

-- Thread for link 3
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000b0003', '00000000-0000-0000-0000-000000000003',
        true, false, NOW() - INTERVAL '60 days', NOW() - INTERVAL '5 days');

-- User history for link 3 (recent - 5 days old)
INSERT INTO email_user_history (link_id, thread_id, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000b0003',
        NOW() - INTERVAL '60 days', NOW() - INTERVAL '5 days');

------------------------------------------------------------
-- Link 4: NEW link with no history (should NOT be deleted)
-- Created recently (10 days ago), no history yet
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000004', 'macro|new_user@example.com', '00000000-0000-0000-0000-0000000a0004',
        'new_user@example.com', 'GMAIL', true, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days');

-- Thread for link 4
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000b0004', '00000000-0000-0000-0000-000000000004',
        true, false, NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days');

------------------------------------------------------------
-- Link 5: INTERNAL @macro.com link (should NEVER be deleted)
-- Old link with no history, but has @macro.com in macro_id
------------------------------------------------------------

INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000005', 'internal@macro.com', '00000000-0000-0000-0000-0000000a0005',
        'internal@macro.com', 'GMAIL', true, NOW() - INTERVAL '200 days', NOW() - INTERVAL '200 days');

-- Thread for link 5
INSERT INTO email_threads (id, link_id, inbox_visible, is_read, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-0000000b0005', '00000000-0000-0000-0000-000000000005',
        true, false, NOW() - INTERVAL '200 days', NOW() - INTERVAL '200 days');