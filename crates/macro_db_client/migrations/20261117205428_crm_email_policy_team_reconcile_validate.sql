SET LOCAL lock_timeout = '5s';
ALTER TABLE crm_email_policy_source_events
    VALIDATE CONSTRAINT crm_email_policy_source_events_source_kind_check,
    VALIDATE CONSTRAINT crm_email_policy_source_events_team_identity;
