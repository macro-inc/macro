-- Entity reads ask for one viewer's notifications on one entity. The entity
-- lives on `notification` and the viewer on `user_notification`, so no index
-- covered both: every read scanned the entity's notifications for all users,
-- which for a busy channel is every message it has had.
-- Copy the entity and event type onto each recipient row so one index answers
-- the read. A notification's entity and type never change after insert;
-- notification ingress writes the copies with each recipient row.
-- Fail fast instead of queueing every notification read behind a long
-- transaction while waiting for the table lock.
SET LOCAL lock_timeout = '5s';

ALTER TABLE user_notification
    ADD COLUMN event_item_type text,
    ADD COLUMN event_item_id text,
    ADD COLUMN notification_event_type text;
