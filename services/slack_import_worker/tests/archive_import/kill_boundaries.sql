-- Installed only in a SQLx-created isolated test database. Each trigger pauses
-- the real worker at a durable boundary; the parent holds advisory lock 27001.
CREATE FUNCTION pause_archive_worker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    CASE TG_TABLE_NAME
    WHEN 'comms_channels' THEN
        IF current_setting('application_name') = 'kill-after-lease' THEN
            PERFORM pg_advisory_xact_lock(27001);
        END IF;
    WHEN 'slack_import_conversation' THEN
        IF current_setting('application_name') = 'kill-after-batch'
            AND NEW.status = 'completed' THEN
            PERFORM pg_advisory_xact_lock(27001);
        END IF;
    WHEN 'slack_import_outbox' THEN
        IF current_setting('application_name') = 'kill-after-publication'
            AND NEW.published_at IS NOT NULL THEN
            PERFORM pg_advisory_xact_lock(27001);
        END IF;
    END CASE;
    RETURN NEW;
END;
$$;
CREATE TRIGGER pause_channel BEFORE INSERT ON comms_channels
    FOR EACH ROW EXECUTE FUNCTION pause_archive_worker();
CREATE TRIGGER pause_completion BEFORE UPDATE ON slack_import_conversation
    FOR EACH ROW EXECUTE FUNCTION pause_archive_worker();
CREATE TRIGGER pause_publication BEFORE UPDATE ON slack_import_outbox
    FOR EACH ROW EXECUTE FUNCTION pause_archive_worker();
