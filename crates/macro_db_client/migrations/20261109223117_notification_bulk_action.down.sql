SET lock_timeout = '5s';

DROP TRIGGER IF EXISTS trg_clear_user_notification_done_by ON user_notification;
DROP FUNCTION IF EXISTS clear_user_notification_done_by();
ALTER TABLE user_notification DROP COLUMN IF EXISTS done_by;
DROP TABLE IF EXISTS notification_bulk_action_item;
DROP TABLE IF EXISTS notification_bulk_action;
