-- Add migration script here
ALTER TABLE user_notification_item_unsubscribe
    ADD COLUMN snoozed_until TIMESTAMPTZ;

COMMENT ON COLUMN user_notification_item_unsubscribe.snoozed_until IS
    'NULL means muted indefinitely; a future deadline pauses notifications until then.';
