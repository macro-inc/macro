-- The email transaction durably schedules recovery even if inline extraction fails.
ALTER TABLE email_message_calendar_extraction
    DROP CONSTRAINT email_message_calendar_extraction_status_check,
    ADD CHECK (status IN ('unprocessed', 'pending', 'ready', 'absent', 'unsupported')),
    ADD COLUMN generation bigint NOT NULL DEFAULT 0,
    ADD COLUMN notification_pending boolean NOT NULL DEFAULT false;
DROP INDEX email_message_calendar_extraction_pending;
CREATE INDEX email_message_calendar_extraction_pending
    ON email_message_calendar_extraction(retry_after)
    WHERE status IN ('unprocessed', 'pending') OR notification_pending;
CREATE FUNCTION enqueue_email_invitation_extraction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT NEW.is_draft AND NEW.provider_id IS NOT NULL THEN
        INSERT INTO email_message_calendar_extraction(message_id, status, parser_version, retry_after)
        VALUES (NEW.id, 'unprocessed', 0, now() + interval '5 minutes')
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER enqueue_email_invitation_extraction
    AFTER INSERT OR UPDATE OF is_draft ON email_messages
    FOR EACH ROW EXECUTE FUNCTION enqueue_email_invitation_extraction();

-- A recurring exception advances independently of its master.
ALTER TABLE calendar_event_overrides ADD COLUMN sequence integer,
    ADD COLUMN source_updated_at timestamptz;
