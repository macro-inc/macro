-- Validate the checks the previous migration installed NOT VALID, in their own
-- transaction (SHARE UPDATE EXCLUSIVE only).
SET LOCAL lock_timeout = '5s';
ALTER TABLE external_chat VALIDATE CONSTRAINT external_chat_provider_check;
ALTER TABLE external_chat VALIDATE CONSTRAINT external_chat_slack_remote_id_check;
