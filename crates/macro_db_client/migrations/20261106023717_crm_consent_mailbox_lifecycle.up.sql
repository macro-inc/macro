CREATE INDEX crm_email_consent_enabled_link ON crm_email_consent(link_id) WHERE enabled;

-- A connection returning to primary/connected status must not resurrect an
-- earlier grant, even when the mailbox row keeps the same ID. This trigger
-- takes no CRM advisory lock: connection writers already own the mailbox row.
-- Consent admission locks that row FOR SHARE before changing the consent row,
-- keeping the mailbox -> consent order consistent with this lifecycle writer.
CREATE FUNCTION crm_revoke_changed_mailbox_consent() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE crm_email_consent
    SET enabled = FALSE, updated_at = now()
    WHERE link_id = NEW.id AND enabled;
    RETURN NEW;
END;
$$;

CREATE TRIGGER email_links_revoke_crm_consent
AFTER UPDATE OF is_primary, deleting_at, disconnect_requested_at, needs_reauth,
    macro_id, email_address ON email_links
FOR EACH ROW WHEN (
    OLD.is_primary IS DISTINCT FROM NEW.is_primary
    OR OLD.deleting_at IS DISTINCT FROM NEW.deleting_at
    OR OLD.disconnect_requested_at IS DISTINCT FROM NEW.disconnect_requested_at
    OR (NOT OLD.needs_reauth AND NEW.needs_reauth)
    OR OLD.macro_id IS DISTINCT FROM NEW.macro_id
    OR OLD.email_address IS DISTINCT FROM NEW.email_address
)
EXECUTE FUNCTION crm_revoke_changed_mailbox_consent();
