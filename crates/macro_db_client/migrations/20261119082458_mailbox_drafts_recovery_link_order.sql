-- no-transaction
-- Paused writes inspect uncertainty checkpoints without walking ordinary queued drafts.
-- If interrupted, drop an INVALID index before rerunning this migration.
CREATE INDEX CONCURRENTLY email_mailbox_drafts_recovery_link_order
    ON email_mailbox_drafts(link_id, available_at, message_id)
    WHERE state IN ('pending','running','synced')
      AND checkpoint->>'stage' IN ('creating','submitting','confirming');
