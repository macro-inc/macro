SET lock_timeout = '5s';
ALTER TABLE external_chat_attachment VALIDATE CONSTRAINT external_chat_attachment_downloaded_hash;
