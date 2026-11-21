SET LOCAL lock_timeout = '5s';
ALTER TABLE crm_email_policy_previews
    VALIDATE CONSTRAINT crm_email_policy_previews_observation;
