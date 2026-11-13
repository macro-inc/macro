-- Attachment download state belongs to the chat's provider, not to WhatsApp.
-- `account_id` is the provider account that downloads the attachment, in
-- that provider's own account table, so it no longer references
-- `whatsapp_linked_account`. An account that is deleted leaves its pending
-- attachments unclaimed, as the old ON DELETE SET NULL did.
SET lock_timeout = '5s';

ALTER TABLE external_chat_attachment DROP CONSTRAINT external_chat_attachment_account_id_fkey;

-- Some providers only learn an attachment's hash once they download it.
ALTER TABLE external_chat_attachment ALTER COLUMN sha256 DROP NOT NULL;
ALTER TABLE external_chat_attachment ADD CONSTRAINT external_chat_attachment_downloaded_hash
    CHECK (sha256 IS NOT NULL OR state IN ('pending', 'failed', 'deleted')) NOT VALID;
