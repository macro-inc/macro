-- The github_pr_event notification type was renamed to github_pr_status_changed.
-- Rewrite persisted rows so stored notifications and per-type preferences keep
-- working under the new tag.
UPDATE notification
SET notification_event_type = 'github_pr_status_changed'
WHERE notification_event_type = 'github_pr_event';

UPDATE user_notification_type_preference
SET notification_event_type = 'github_pr_status_changed'
WHERE notification_event_type = 'github_pr_event';
