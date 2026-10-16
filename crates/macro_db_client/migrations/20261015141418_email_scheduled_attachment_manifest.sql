-- Retain approved identities even if a forwarded source is later deleted.
ALTER TABLE email_scheduled_messages ADD COLUMN approved_attachments JSONB NOT NULL
    DEFAULT '{"uploaded": [], "forwarded": []}'::jsonb;

CREATE FUNCTION capture_email_scheduled_attachments() RETURNS trigger AS $$
BEGIN
    -- Match admission and mutation lock order, including older schedule writers.
    PERFORM id FROM email_messages WHERE id = NEW.message_id FOR UPDATE;
    NEW.approved_attachments := jsonb_build_object(
        'uploaded', COALESCE((SELECT jsonb_agg(id ORDER BY id)
            FROM email_attachments_drafts WHERE draft_id = NEW.message_id), '[]'::jsonb),
        'forwarded', COALESCE((SELECT jsonb_agg(attachment_id ORDER BY attachment_id)
            FROM email_attachments_fwd WHERE message_id = NEW.message_id), '[]'::jsonb)
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER capture_email_scheduled_attachments
    BEFORE INSERT ON email_scheduled_messages
    FOR EACH ROW EXECUTE FUNCTION capture_email_scheduled_attachments();

UPDATE email_scheduled_messages s SET approved_attachments = jsonb_build_object(
    'uploaded', COALESCE((SELECT jsonb_agg(id ORDER BY id)
        FROM email_attachments_drafts WHERE draft_id = s.message_id), '[]'::jsonb),
    'forwarded', COALESCE((SELECT jsonb_agg(attachment_id ORDER BY attachment_id)
        FROM email_attachments_fwd WHERE message_id = s.message_id), '[]'::jsonb)
);
