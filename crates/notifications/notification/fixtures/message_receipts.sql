-- Setup: Create a notification and user_notification first
INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata)
VALUES ('0193b1ea-c742-7589-893b-2b4a509c1e77', 'test', 'item-2', 'document', 'test_service', '{}');

INSERT INTO user_notification (user_id, notification_id, created_at)
VALUES ('macro|receipt_user@test.com', '0193b1ea-c742-7589-893b-2b4a509c1e77', '2025-01-01 00:00:00');

-- Insert message receipts for testing
INSERT INTO notification_message_receipt (message_id, user_id, notification_id, failed)
VALUES
  ('msg-1', 'macro|receipt_user@test.com', '0193b1ea-c742-7589-893b-2b4a509c1e77', false),
  ('msg-2', 'macro|receipt_user@test.com', '0193b1ea-c742-7589-893b-2b4a509c1e77', true);
