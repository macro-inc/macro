-- The active-link index is installed first. Keep the existing mailbox trigger:
-- its lifecycle conditions and mailbox-before-consent lock order do not change.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION crm_revoke_changed_mailbox_consent() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE crm_email_consent
    SET enabled = FALSE, selected_enabled = FALSE, updated_at = now()
    WHERE link_id = NEW.id AND (enabled OR selected_enabled);
    RETURN NEW;
END;
$$;
