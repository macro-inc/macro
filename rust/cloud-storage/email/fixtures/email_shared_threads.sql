-- Fixture for testing shared email thread filtering.
-- Builds on email_dynamic_query fixture by adding a second user with their own
-- email threads, some of which are shared with user1 via UserItemAccess or project membership.

-- == Second user ==
INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES ('b2222222-2222-2222-2222-222222222222', 'user2@test.com', 'user2@test.com', 'stripe_user2');

INSERT INTO "User" (id, email, name, macro_user_id)
VALUES ('macro|user2@test.com', 'user2@test.com', 'Test User 2', 'b2222222-2222-2222-2222-222222222222');

-- Second user's email link
INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, is_sync_active, created_at, updated_at)
VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'macro|user2@test.com', 'user2', 'user2@test.com', 'GMAIL', true, NOW(), NOW());

-- Contacts for user2's link
INSERT INTO email_contacts (id, link_id, email_address, name, created_at, updated_at)
VALUES
    ('40000005-0000-0000-0000-000000000005', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'external@example.com', 'External Person', NOW(), NOW());

-- Labels for user2's link
INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('10000101-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'INBOX', 'INBOX', 'Show', 'LabelShow', 'System', NOW()),
    ('10000101-0000-0000-0000-000000000006', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'TRASH', 'TRASH', 'Hide', 'LabelHide', 'System', NOW());

-- == Shared project: user1 has access to this project owned by user2 ==
INSERT INTO "Project" (id, name, "userId", "createdAt", "updatedAt")
VALUES ('proj-cccc-cccc-cccc-cccccccccccc', 'Shared Project', 'macro|user2@test.com', NOW(), NOW());

-- Grant user1 access to the shared project
INSERT INTO "UserItemAccess" (id, user_id, item_id, item_type, access_level, created_at, updated_at)
VALUES ('acc00000-0000-0000-0000-000000000001', 'macro|user1@test.com', 'proj-cccc-cccc-cccc-cccccccccccc', 'project', 'view', NOW(), NOW());

-- == User2's email threads ==

-- Thread 101: Directly shared with user1 via UserItemAccess (not in any shared project)
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at
)
VALUES
    ('20000101-0000-0000-0000-000000000101', 'shared_thread1', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
     true, false, '2024-02-01 10:00:00+00', NULL, '2024-02-01 10:00:00+00', NOW(), NOW());

-- Thread 102: Lives in the shared project (inherited access via project membership)
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at, project_id
)
VALUES
    ('20000102-0000-0000-0000-000000000102', 'shared_thread2', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
     true, false, '2024-02-02 10:00:00+00', NULL, '2024-02-02 10:00:00+00', NOW(), NOW(),
     'proj-cccc-cccc-cccc-cccccccccccc');

-- Thread 103: User2's thread NOT shared with user1 (should never appear)
INSERT INTO email_threads (
    id, provider_id, link_id, inbox_visible, is_read,
    latest_inbound_message_ts, latest_outbound_message_ts, latest_non_spam_message_ts,
    created_at, updated_at
)
VALUES
    ('20000103-0000-0000-0000-000000000103', 'not_shared_thread', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
     true, false, '2024-02-03 10:00:00+00', NULL, '2024-02-03 10:00:00+00', NOW(), NOW());

-- Direct share: thread 101 shared with user1
INSERT INTO "UserItemAccess" (id, user_id, item_id, item_type, access_level, created_at, updated_at)
VALUES ('acc00000-0000-0000-0000-000000000002', 'macro|user1@test.com', '20000101-0000-0000-0000-000000000101', 'thread', 'view', NOW(), NOW());

-- == Messages for user2's threads ==
INSERT INTO email_messages (
    id, thread_id, link_id, provider_id, from_contact_id,
    subject, snippet, internal_date_ts,
    is_draft, is_sent, is_starred, is_read,
    created_at, updated_at
)
VALUES
    -- Message for directly shared thread 101
    ('30000101-0000-0000-0000-000000000101', '20000101-0000-0000-0000-000000000101',
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'shared_msg1', '40000005-0000-0000-0000-000000000005',
     'Shared Thread Direct', 'This thread is directly shared', '2024-02-01 10:00:00+00',
     false, false, false, false, NOW(), NOW()),

    -- Message for project-shared thread 102
    ('30000102-0000-0000-0000-000000000102', '20000102-0000-0000-0000-000000000102',
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'shared_msg2', '40000005-0000-0000-0000-000000000005',
     'Shared Thread Project', 'This thread is shared via project', '2024-02-02 10:00:00+00',
     false, false, false, false, NOW(), NOW()),

    -- Message for NOT shared thread 103
    ('30000103-0000-0000-0000-000000000103', '20000103-0000-0000-0000-000000000103',
     'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'not_shared_msg', '40000005-0000-0000-0000-000000000005',
     'Not Shared Thread', 'This thread should not be visible', '2024-02-03 10:00:00+00',
     false, false, false, false, NOW(), NOW());

-- Message labels for user2's threads
INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('30000101-0000-0000-0000-000000000101', '10000101-0000-0000-0000-000000000001'),
    ('30000102-0000-0000-0000-000000000102', '10000101-0000-0000-0000-000000000001'),
    ('30000103-0000-0000-0000-000000000103', '10000101-0000-0000-0000-000000000001');
