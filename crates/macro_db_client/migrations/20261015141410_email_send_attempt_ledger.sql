-- Attempt tombstones outlive message deletion so delayed requests cannot send again.
-- Removing an inbox removes its delivery authority and all its attempts.
CREATE TABLE email_send_attempts (
    user_id TEXT NOT NULL,
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    attempt_id UUID NOT NULL,
    request JSONB,
    message_id UUID,
    thread_id UUID,
    send_time TIMESTAMPTZ,
    cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    restore_body_html TEXT,
    restore_body_text TEXT,
    restore_body_macro TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent BOOLEAN NOT NULL DEFAULT FALSE,
    delivery_unconfirmed BOOLEAN NOT NULL DEFAULT FALSE,
    -- Compare the versioned approval digest in request; retain the full snapshot only while active.
    prepared_content JSONB,
    PRIMARY KEY (user_id, link_id, attempt_id)
);
CREATE INDEX email_send_attempts_message_idx ON email_send_attempts(message_id)
    WHERE message_id IS NOT NULL;

-- Terminal tombstones keep approval identity, never duplicate message content.
CREATE FUNCTION email_send_attempt_identity(request JSONB) RETURNS JSONB AS $$
    SELECT CASE WHEN request IS NULL THEN NULL ELSE jsonb_build_object(
        '_send_approval', COALESCE(request->'_send_approval', '{"version":0,"digest":""}'::jsonb)
    ) END;
$$ LANGUAGE SQL IMMUTABLE;

CREATE FUNCTION clear_terminal_email_send_content() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.sent OR NEW.cancelled THEN
        -- A legacy request without a digest becomes an unsupported-version
        -- identity: late admission fails closed rather than retaining its body.
        NEW.request := email_send_attempt_identity(NEW.request);
        NEW.prepared_content := NULL;
        NEW.restore_body_html := NULL;
        NEW.restore_body_text := NULL;
        NEW.restore_body_macro := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER clear_terminal_email_send_content
BEFORE INSERT OR UPDATE ON email_send_attempts
FOR EACH ROW EXECUTE FUNCTION clear_terminal_email_send_content();

-- Delivery facts outlive the message, including provider synchronization and deletion.
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

CREATE FUNCTION preserve_deleted_email_send_delivery() RETURNS TRIGGER AS $$
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
    UPDATE email_send_attempts
    SET request = email_send_attempt_identity(request), prepared_content = NULL,
        restore_body_html = NULL, restore_body_text = NULL, restore_body_macro = NULL
    WHERE message_id = OLD.id AND link_id = OLD.link_id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_send_attempt_delivery_before_delete
BEFORE DELETE ON email_messages
FOR EACH ROW EXECUTE FUNCTION preserve_deleted_email_send_delivery();
