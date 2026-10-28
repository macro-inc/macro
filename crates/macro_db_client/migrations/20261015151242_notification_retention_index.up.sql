-- no-transaction
-- One statement: SQLx sends nontransactional migrations as one query.
-- Retention scans oldest-first without sorting the notification history.
CREATE INDEX CONCURRENTLY idx_notification_retention
    ON notification (created_at, id);
