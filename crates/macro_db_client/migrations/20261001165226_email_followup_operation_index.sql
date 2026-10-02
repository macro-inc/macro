-- Foreign-key cleanup must not scan the retained operation history.
CREATE INDEX IF NOT EXISTS idx_reminder_email_operation_reminder
    ON reminder_email_operation (reminder_id);
