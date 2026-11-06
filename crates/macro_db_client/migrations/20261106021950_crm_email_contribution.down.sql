DROP TRIGGER team_crm_settings_keep_email_sharing_disabled ON team_crm_settings;
DROP FUNCTION crm_disable_legacy_email_sharing();
DROP FUNCTION crm_email_thread_allowed(UUID, UUID);
DROP FUNCTION crm_email_domain_blocked(UUID, TEXT, TEXT);
DROP TABLE crm_email_backfill_outbox;
DROP TABLE crm_personal_email_blocklist;
DROP TABLE crm_email_consent;
