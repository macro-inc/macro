CREATE INDEX notification_digest_receipt_cleanup_unscheduled_idx
    ON notification_digest_receipt_cleanup (notification_id, generation)
    WHERE safe_after IS NULL;
