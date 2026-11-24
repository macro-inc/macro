SET LOCAL lock_timeout = '1s';

-- Digests of the content the provider held when the draft last synced. A draft
-- whose version moved while its content kept them was not edited.
ALTER TABLE email_mailbox_drafts ADD COLUMN base_content JSONB;
