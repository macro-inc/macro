SET LOCAL lock_timeout = '5s';

-- Retain sync deletions while accepted delivery still owns the message.
-- The generation prevents an old deletion from affecting a draft restored by Undo.
CREATE TABLE email_deferred_message_deletions (
    message_id UUID PRIMARY KEY REFERENCES email_messages(id) ON DELETE CASCADE,
    provider_id TEXT,
    draft_generation INTEGER NOT NULL
);

CREATE OR REPLACE FUNCTION preserve_deleted_email_send_delivery() RETURNS TRIGGER AS $$
DECLARE
    scheduled email_scheduled_messages%ROWTYPE;
BEGIN
    -- DELETE already owns the message lock shared with admission/cancellation.
    -- Explicit inbox removal revokes delivery authority; permit batched purge
    -- while the link is marked deleting, and direct parent FK cascades.
    IF NOT OLD.is_sent AND EXISTS (SELECT 1 FROM email_links
                                  WHERE id = OLD.link_id AND deleting_at IS NULL)
       AND EXISTS (SELECT 1 FROM email_send_attempts
                   WHERE message_id = OLD.id AND link_id = OLD.link_id
                     AND NOT cancelled AND NOT sent) THEN
        INSERT INTO email_deferred_message_deletions (message_id, provider_id, draft_generation)
        VALUES (OLD.id, OLD.provider_id, OLD.draft_generation)
        ON CONFLICT (message_id) DO UPDATE
            SET provider_id = EXCLUDED.provider_id, draft_generation = EXCLUDED.draft_generation;
        -- Stop before compacting content or cascading to jobs and attachments.
        RETURN NULL;
    END IF;
    -- Match the worker's message -> schedule lock order. If submission is racing
    -- deletion, either we observe its boundary or its subsequent UPDATE finds no row.
    SELECT * INTO scheduled FROM email_scheduled_messages
    WHERE message_id = OLD.id AND link_id = OLD.link_id FOR UPDATE;

    IF OLD.is_sent OR COALESCE(scheduled.sent, FALSE) THEN
        UPDATE email_send_attempts SET sent = TRUE
        WHERE message_id = OLD.id AND link_id = OLD.link_id
          AND NOT cancelled AND NOT sent;
    ELSIF scheduled.delivery_status <> 'failed' AND (
        scheduled.delivery_started_at IS NOT NULL
        OR scheduled.delivery_status = 'unconfirmed'
        OR (scheduled.processing AND scheduled.delivery_claim_id IS NULL)
    ) THEN
        UPDATE email_send_attempts SET delivery_unconfirmed = TRUE
        WHERE message_id = OLD.id AND link_id = OLD.link_id
          AND NOT cancelled AND NOT sent;
    END IF;
    UPDATE email_send_attempts
    SET request = email_send_attempt_identity(request), prepared_content = NULL,
        restore_body_html = NULL, restore_body_text = NULL, restore_body_macro = NULL
    WHERE message_id = OLD.id AND link_id = OLD.link_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;
