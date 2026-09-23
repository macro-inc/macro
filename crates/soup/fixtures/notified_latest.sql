-- Extends notified_at: timestamp ties, an older notification with a larger id,
-- and a chat sharing a document's id. Notification-table timestamps deliberately
-- differ from the recipient timestamps that define notified_at.

INSERT INTO public."Chat" ("id", "name", "userId", "createdAt", "updatedAt")
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Same-id chat', 'macro|user-1@test.com', '2024-06-01 10:00:00', '2024-06-01 10:00:00');

INSERT INTO public.entity_access (entity_id, entity_type, source_id, source_type, access_level)
VALUES ('11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'macro|user-1@test.com', 'user', 'owner');

INSERT INTO public.notification (id, notification_event_type, event_item_id, event_item_type, service_sender, created_at)
VALUES
('0190b000-0000-7000-8000-000000000001', 'document_comment', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'test', '2024-06-01 11:00:00'),
('0190b000-0000-7000-8000-000000000002', 'document_comment', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'test', '2024-06-01 11:00:00'),
('0190b000-0000-7000-8000-000000000003', 'document_comment', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'document', 'test', '2024-06-01 11:00:00'),
('0190b000-0000-7000-8000-000000000004', 'chat_complete', '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'chat', 'test', '2024-06-01 11:00:00');

INSERT INTO public.user_notification (user_id, notification_id, created_at, sent, state)
VALUES
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000001', '2024-06-01 10:09:00', TRUE, 'done'),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000002', '2024-06-01 10:09:00', TRUE, 'done'),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000003', '2024-06-01 10:01:00', TRUE, 'unseen'),
('macro|user-1@test.com', '0190b000-0000-7000-8000-000000000004', '2024-06-01 10:10:00', TRUE, 'unseen');

-- Only old document notifications match "unseen". The document must still be
-- ordered at T9, not at the matching notification's T1.
UPDATE public.user_notification
SET state = 'done'
WHERE user_id = 'macro|user-1@test.com'
  AND notification_id = '0190a000-0000-7000-8000-000000000009';
