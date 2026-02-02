-- Notification with a collapse key
INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id, apns_collapse_key)
VALUES ('0193b1ea-a542-7589-893b-2b4a509c1e76', 'test', 'item-1', 'document', 'test_service', '{}', NULL, 'collapse-key-1');

-- Notification without a collapse key
INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id, apns_collapse_key)
VALUES ('0193b1ea-b642-7589-893b-2b4a509c1e76', 'test', 'item-2', 'document', 'test_service', '{}', NULL, NULL);

-- User notification records
INSERT INTO user_notification (user_id, notification_id, created_at)
VALUES ('macro|user@test.com', '0193b1ea-a542-7589-893b-2b4a509c1e76', '2025-01-01 00:00:00');

INSERT INTO user_notification (user_id, notification_id, created_at)
VALUES ('macro|user@test.com', '0193b1ea-b642-7589-893b-2b4a509c1e76', '2025-01-01 00:00:01');
