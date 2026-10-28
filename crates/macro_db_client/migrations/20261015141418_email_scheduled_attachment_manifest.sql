-- One provider-file set for native imported files and explicit forwards.
CREATE FUNCTION email_draft_provider_attachment_ids(UUID, UUID)
RETURNS TABLE(attachment_id UUID) AS $$
SELECT a.id FROM email_attachments a
        JOIN email_messages m ON m.id=a.message_id WHERE m.id=$1 AND m.link_id=$2
        AND NOT EXISTS(SELECT 1 FROM email_draft_attachment_removals r WHERE r.message_id=m.id AND (r.provider_id=a.provider_attachment_id OR trim(both '<>' from r.content_id)=trim(both '<>' from a.content_id)))
        AND NOT EXISTS(SELECT 1 FROM email_attachments_drafts u WHERE u.draft_id=m.id AND trim(both '<>' from a.content_id)=COALESCE(trim(both '<>' from u.content_id),u.id::text||'@attachments.macro.com'))
        AND NOT EXISTS(SELECT 1 FROM email_attachments_fwd f JOIN email_attachments original ON original.id=f.attachment_id WHERE f.message_id=m.id AND (trim(both '<>' from a.content_id)=trim(both '<>' from original.content_id) OR trim(both '<>' from a.content_id)=f.attachment_id::text||'@attachments.macro.com'))
        UNION SELECT f.attachment_id FROM email_attachments_fwd f JOIN email_messages m ON m.id=f.message_id WHERE m.id=$1 AND m.link_id=$2
$$ LANGUAGE sql STABLE;

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
            FROM email_draft_provider_attachment_ids(NEW.message_id, NEW.link_id)), '[]'::jsonb)
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
        FROM email_draft_provider_attachment_ids(s.message_id, s.link_id)), '[]'::jsonb)
);
