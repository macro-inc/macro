-- A worker may still be preparing an older revision after an editor replaces the
-- current shadow. Keep its input reachable until its fenced lease expires.
ALTER TABLE email_mailbox_drafts ADD COLUMN claimed_content JSONB;
CREATE INDEX email_draft_objects_by_key ON email_attachments_drafts(s3_key);
CREATE INDEX email_draft_current_upload_refs ON email_mailbox_drafts USING GIN(desired_content jsonb_path_ops)
    WHERE state NOT IN ('sent','deleted');
CREATE INDEX email_draft_checkpoint_refs ON email_mailbox_drafts USING GIN(checkpoint jsonb_path_ops)
    WHERE state NOT IN ('sent','deleted');
CREATE INDEX email_draft_claimed_upload_refs ON email_mailbox_drafts USING GIN(claimed_content jsonb_path_ops)
    WHERE state NOT IN ('sent','deleted');
