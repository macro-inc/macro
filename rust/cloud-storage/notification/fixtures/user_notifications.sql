INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id)
VALUES ('0193b1ea-a542-7589-893b-2b4a509c1e76', 'test', 'item-1', 'document', 'test_service', NULL, NULL);

INSERT INTO user_notification (user_id, notification_id, created_at)
VALUES ('macro|user@test.com', '0193b1ea-a542-7589-893b-2b4a509c1e76', '2025-01-01 00:00:00');
