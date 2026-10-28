SET LOCAL lock_timeout = '1s';

-- A worker may still be preparing an older revision after an editor replaces the
-- current shadow. Keep its input reachable until its fenced lease expires.
ALTER TABLE email_mailbox_drafts ADD COLUMN claimed_content JSONB;
-- The existing s3_key unique index covers object lookups until its concurrent
-- non-unique replacement is built for shared draft attachment objects.
CREATE INDEX email_draft_current_upload_refs ON email_mailbox_drafts USING GIN(desired_content jsonb_path_ops)
    WHERE state NOT IN ('sent','deleted');
CREATE INDEX email_draft_checkpoint_refs ON email_mailbox_drafts USING GIN(checkpoint jsonb_path_ops)
    WHERE state NOT IN ('sent','deleted');
CREATE INDEX email_draft_claimed_upload_refs ON email_mailbox_drafts USING GIN(claimed_content jsonb_path_ops)
    WHERE state NOT IN ('sent','deleted');
