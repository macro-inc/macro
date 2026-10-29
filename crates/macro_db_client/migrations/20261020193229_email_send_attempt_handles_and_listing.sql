SET lock_timeout = '5s';

-- Retain handles after message deletion. Otherwise a delayed offline save can
-- mistake the cascaded client-ID mapping for a draft that has never been saved.
ALTER TABLE email_send_attempts ADD COLUMN draft_handles uuid[] NOT NULL DEFAULT '{}';
UPDATE email_send_attempts a
SET draft_handles = ARRAY(
    SELECT DISTINCT handle FROM (
        SELECT a.message_id AS handle
        UNION ALL
        SELECT c.client_id FROM email_draft_client_ids c
        WHERE c.message_id = a.message_id AND c.link_id = a.link_id
    ) handles WHERE handle IS NOT NULL
);

CREATE INDEX email_send_attempts_pending_actor
    ON email_send_attempts (user_id, created_at DESC, link_id DESC, attempt_id DESC)
    WHERE NOT cancelled AND NOT sent;
CREATE INDEX email_send_attempts_inbox ON email_send_attempts (link_id);
