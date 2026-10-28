INSERT INTO user_notification_item_unsubscribe (user_id, item_id, item_type, snoozed_until)
VALUES
    ('macro|alice@example.com', 'document-snoozed', 'document', NOW() + INTERVAL '1 hour'),
    ('macro|alice@example.com', 'channel-muted', 'channel', NULL),
    ('macro|alice@example.com', 'email-alias', 'email', NULL),
    ('macro|alice@example.com', 'thread-alias', 'thread', NULL),
    ('macro|alice@example.com', 'foreign-alias', 'foreign', NULL),
    ('macro|alice@example.com', 'unknown-note', 'note', NULL),
    ('macro|alice@example.com', 'unknown-task', 'task', NULL),
    ('macro|alice@example.com', 'unknown-dm', 'dm', NULL),
    ('macro|alice@example.com', 'unknown-thread', 'channel_thread', NULL),
    ('macro|alice@example.com', 'expired', 'document', NOW() - INTERVAL '1 hour'),
    ('macro|bob@example.com', 'other-user', 'document', NULL);
