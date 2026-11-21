-- no-transaction
-- Each provider link contributes only its oldest eligible draft to a global claim.
-- If interrupted, drop an INVALID index before rerunning this migration.
CREATE INDEX CONCURRENTLY email_mailbox_drafts_link_claim_order
    ON email_mailbox_drafts(link_id, available_at, message_id)
    WHERE state IN ('pending','running','synced');
