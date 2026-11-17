-- no-transaction
CREATE INDEX CONCURRENTLY crm_email_consent_active_link
ON crm_email_consent(link_id) WHERE enabled OR selected_enabled;
