-- Checks existing rows under a lock that lets writes continue.
SET LOCAL lock_timeout = '5s';

ALTER TABLE crm_email_policy_audit VALIDATE CONSTRAINT crm_email_policy_audit_action_check;
