SET LOCAL lock_timeout = '5s';

ALTER TABLE macro_user
    ADD COLUMN mailbox_handle_claimed_at TIMESTAMPTZ;

-- Preserve the column and every dependent object. PostgreSQL 17 removes the
-- generated expression without dropping the column or its CRM trigger.
ALTER TABLE email_links
    ALTER COLUMN is_primary DROP EXPRESSION;

-- A BEFORE trigger distinguishes omitted values from old writers (NULL) from
-- explicit primary facts supplied by new writers. NOT NULL remains enforced.
ALTER TABLE email_links
    ALTER COLUMN is_primary SET DEFAULT NULL;

-- DROP EXPRESSION preserves every existing computed value. Migrations deploy
-- before ROX writers, so no table-wide backfill is needed or permitted here.
CREATE FUNCTION email_links_preserve_legacy_primary() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.is_primary IS NULL THEN
        NEW.is_primary := NEW.macro_id = 'macro|' || lower(NEW.email_address::text);
    ELSIF TG_OP = 'UPDATE'
        AND NEW.is_primary IS NOT DISTINCT FROM OLD.is_primary
        AND (OLD.macro_id IS DISTINCT FROM NEW.macro_id
            OR OLD.email_address IS DISTINCT FROM NEW.email_address)
    THEN
        NEW.is_primary := NEW.macro_id = 'macro|' || lower(NEW.email_address::text);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER email_links_preserve_legacy_primary
BEFORE INSERT OR UPDATE OF macro_id, email_address ON email_links
FOR EACH ROW EXECUTE FUNCTION email_links_preserve_legacy_primary();

-- Recreate the consent guard atomically even on engines where changing the
-- generated expression drops dependent objects. Returning to primary or a
-- connected state must never resurrect an earlier grant.
DROP TRIGGER IF EXISTS email_links_revoke_crm_consent ON email_links;
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
