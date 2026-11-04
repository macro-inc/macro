DROP TABLE email_mailbox_lifecycle_outbox;
DROP TABLE email_mailbox_custodians;
DROP TABLE email_link_microsoft_scopes;
ALTER TABLE email_links DROP COLUMN disconnect_requested_at;
