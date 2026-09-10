-- Coordinated cutover: all readers and writers must use state before resuming traffic.
-- Do not deploy this migration independently of the notification-state application change.
CREATE TYPE notification_state AS ENUM ('unseen', 'seen', 'done');

ALTER TABLE user_notification
    ADD COLUMN state notification_state NOT NULL DEFAULT 'unseen';

-- Done takes precedence, including legacy done notifications with no recorded view.
-- Include soft-deleted rows so restoring a notification cannot restore invalid state.
-- Retain seen_at verbatim: it is historical metadata, not a source of lifecycle state.
UPDATE user_notification
SET state = CASE
    WHEN done THEN 'done'::notification_state
    ELSE 'seen'::notification_state
END
WHERE done OR seen_at IS NOT NULL;

DROP INDEX idx_user_notification_active_filter;

ALTER TABLE user_notification DROP COLUMN done;

CREATE INDEX idx_user_notification_active_filter
    ON user_notification (user_id, notification_id, state)
    WHERE deleted_at IS NULL;

COMMENT ON COLUMN user_notification.state IS
    'Authoritative lifecycle state: unseen, seen, or done. Independent of delivery and deletion.';
COMMENT ON COLUMN user_notification.seen_at IS
    'Historical viewing timestamp; nullable even for migrated done notifications. Do not infer state from this column.';
