SET LOCAL lock_timeout = '5s';

DROP TRIGGER email_links_preserve_legacy_primary ON email_links;
DROP FUNCTION email_links_preserve_legacy_primary();

-- Restore the historical generated fact without cascading into other objects.
-- The consent trigger is deliberately detached and restored in this transaction.
DROP TRIGGER IF EXISTS email_links_revoke_crm_consent ON email_links;
ALTER TABLE email_links DROP COLUMN is_primary;
ALTER TABLE email_links
    ADD COLUMN is_primary boolean NOT NULL
    GENERATED ALWAYS AS (macro_id = 'macro|' || lower(email_address::text)) STORED;

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

ALTER TABLE macro_user DROP COLUMN mailbox_handle_claimed_at;
