-- Do not queue mailbox writes behind lifecycle-trigger DDL on a busy table.
SET LOCAL lock_timeout = '5s';

DROP TRIGGER email_links_revoke_crm_consent ON email_links;
DROP FUNCTION crm_revoke_changed_mailbox_consent();
DROP INDEX crm_email_consent_enabled_link;
