SET lock_timeout = '5s';

-- A Gmail draft may move inboxes at admission while keeping its old client
-- aliases. Retain those namespaces after provider sync deletes the message.
ALTER TABLE email_send_attempts
    ADD COLUMN draft_link_ids uuid[] NOT NULL DEFAULT '{}';

UPDATE email_send_attempts a
SET draft_link_ids = ARRAY(
    SELECT a.link_id
    UNION SELECT b.link_id FROM email_draft_client_ids b WHERE b.message_id = a.message_id
),
draft_handles = ARRAY(
    SELECT unnest(a.draft_handles)
    UNION SELECT b.client_id FROM email_draft_client_ids b WHERE b.message_id = a.message_id
);
