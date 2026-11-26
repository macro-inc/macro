-- Who may read the labels of user2's inbox, over email_dynamic_query and
-- email_shared_threads: user2 owns it, a delegate manages it, and user1 only has
-- threads 101 (shared directly) and 102 (shared through a project) from it.

INSERT INTO "macro_user" (id, username, email, stripe_customer_id)
VALUES ('c3333333-3333-3333-3333-333333333333', 'delegate@example.com', 'delegate@example.com', 'stripe_delegate');

INSERT INTO "User" (id, email, name, macro_user_id)
VALUES ('macro|delegate@example.com', 'delegate@example.com', 'Delegate', 'c3333333-3333-3333-3333-333333333333');

INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
SELECT 'macro|delegate@example.com', macro_id, id FROM email_links WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

INSERT INTO email_labels (id, link_id, provider_label_id, name, message_list_visibility, label_list_visibility, type, created_at)
VALUES
    ('10000101-0000-0000-0000-000000000007', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Label_7', 'Hiring/Declined', 'Show', 'LabelShow', 'User', NOW()),
    ('10000101-0000-0000-0000-000000000008', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Label_8', 'Work', 'Show', 'LabelShow', 'User', NOW());

INSERT INTO email_message_labels (message_id, label_id)
VALUES
    ('30000101-0000-0000-0000-000000000101', '10000101-0000-0000-0000-000000000007'),
    ('30000102-0000-0000-0000-000000000102', '10000101-0000-0000-0000-000000000008');
