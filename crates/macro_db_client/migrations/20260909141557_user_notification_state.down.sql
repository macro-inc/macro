-- Coordinated rollback only: stop state-based readers and writers first.
-- Restore the legacy representation without fabricating historical view timestamps.
-- The original invalid done/unseen distinction cannot be recovered after transitions.
ALTER TABLE user_notification
    ADD COLUMN done BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE user_notification SET done = TRUE WHERE state = 'done';

DROP INDEX idx_user_notification_active_filter;

ALTER TABLE user_notification DROP COLUMN state;
DROP TYPE notification_state;

CREATE INDEX idx_user_notification_active_filter
    ON user_notification (user_id, notification_id, done, seen_at)
    WHERE deleted_at IS NULL;

COMMENT ON COLUMN user_notification.seen_at IS NULL;
