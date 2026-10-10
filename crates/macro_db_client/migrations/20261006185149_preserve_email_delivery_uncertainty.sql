-- Message deletion must not turn a possibly delivered attempt into a safe retry.
ALTER TABLE email_send_attempts
    ADD COLUMN delivery_unconfirmed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION preserve_deleted_email_send_delivery() RETURNS TRIGGER AS $$
DECLARE
    scheduled email_scheduled_messages%ROWTYPE;
BEGIN
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
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER email_send_attempt_delivery_before_delete ON email_messages;
CREATE TRIGGER email_send_attempt_delivery_before_delete
BEFORE DELETE ON email_messages
FOR EACH ROW EXECUTE FUNCTION preserve_deleted_email_send_delivery();
