-- A merge that rewrites a member's sharing rules records it in their policy
-- history. The table is validated by the next migration, outside this
-- statement's lock.
SET LOCAL lock_timeout = '5s';

ALTER TABLE crm_email_policy_audit
    DROP CONSTRAINT crm_email_policy_audit_action_check,
    ADD CONSTRAINT crm_email_policy_audit_action_check CHECK (action IN (
        'rules_activated', 'all_mail_enabled', 'withdrawn', 'mailbox_revoked',
        'live_targets_changed', 'records_merged'
    )) NOT VALID;
