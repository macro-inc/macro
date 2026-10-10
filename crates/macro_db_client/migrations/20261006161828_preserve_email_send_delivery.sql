-- Add migration script here
-- Delivery is a permanent fact of the attempt, independent of the message lifetime.
ALTER TABLE email_send_attempts ADD COLUMN sent BOOLEAN NOT NULL DEFAULT FALSE;

CREATE FUNCTION record_email_send_attempt_delivery() RETURNS TRIGGER AS $$
BEGIN
    UPDATE email_send_attempts
    SET sent = TRUE
    WHERE message_id = NEW.id AND link_id = NEW.link_id
      AND NOT cancelled AND NOT sent;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_send_attempt_delivery
AFTER UPDATE OF is_sent ON email_messages
FOR EACH ROW WHEN (NEW.is_sent AND NOT OLD.is_sent)
EXECUTE FUNCTION record_email_send_attempt_delivery();

-- Covers already-sent rows as well as deletion by workers deployed before this migration.
CREATE FUNCTION preserve_deleted_email_send_delivery() RETURNS TRIGGER AS $$
BEGIN
    UPDATE email_send_attempts
    SET sent = TRUE
    WHERE message_id = OLD.id AND link_id = OLD.link_id
      AND NOT cancelled AND NOT sent;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_send_attempt_delivery_before_delete
BEFORE DELETE ON email_messages
FOR EACH ROW WHEN (OLD.is_sent)
EXECUTE FUNCTION preserve_deleted_email_send_delivery();

UPDATE email_send_attempts a
SET sent = TRUE
FROM email_messages m
WHERE m.id = a.message_id AND m.link_id = a.link_id AND m.is_sent
  AND NOT a.cancelled AND NOT a.sent;
