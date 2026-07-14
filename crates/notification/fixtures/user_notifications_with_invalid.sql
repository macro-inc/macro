-- Valid notification
INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id)
VALUES ('0193b1ea-a542-7589-893b-2b4a509c1e76', 'test', 'a0000000-0000-0000-0000-000000000001', 'document', 'test_service', '{"message": "hello"}', NULL);

INSERT INTO user_notification (user_id, notification_id, created_at)
VALUES ('macro|user@test.com', '0193b1ea-a542-7589-893b-2b4a509c1e76', '2025-01-01 00:00:00');

-- Notification with invalid entity type (will fail EntityType::from_str)
INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id)
VALUES ('0193b1ea-b642-7589-893b-2b4a509c1e76', 'test', 'a0000000-0000-0000-0000-000000000002', 'bogus_entity', 'test_service', '{"message": "bad entity"}', NULL);

INSERT INTO user_notification (user_id, notification_id, created_at)
VALUES ('macro|user@test.com', '0193b1ea-b642-7589-893b-2b4a509c1e76', '2025-01-02 00:00:00');

-- Notification with invalid metadata (will fail serde_json::from_value)
INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata, sender_id)
VALUES ('0193b1ea-c742-7589-893b-2b4a509c1e76', 'test', 'a0000000-0000-0000-0000-000000000003', 'document', 'test_service', '{"not_message": 123}', NULL);

INSERT INTO user_notification (user_id, notification_id, created_at)
VALUES ('macro|user@test.com', '0193b1ea-c742-7589-893b-2b4a509c1e76', '2025-01-03 00:00:00');
