-- Rollback is safe only before a writer persists a ROX row. This guard makes
-- the writer compatibility gap explicit instead of silently losing mailboxes.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM email_links WHERE provider = 'ROX')
        OR EXISTS (SELECT 1 FROM email_links_history WHERE provider = 'ROX')
        OR EXISTS (SELECT 1 FROM in_progress_user_link WHERE email_provider = 'ROX')
    THEN
        RAISE EXCEPTION 'cannot remove ROX provider while ROX email links exist';
    END IF;
END;
$$;

-- This partial index carries an enum-typed predicate and must be rebuilt with
-- the restored type; dropping it does not remove mailbox data.
DROP INDEX email_links_outlook_identity;
ALTER TABLE in_progress_user_link ALTER COLUMN email_provider DROP DEFAULT;
ALTER TYPE email_user_provider_enum RENAME TO email_user_provider_enum_with_rox;
CREATE TYPE email_user_provider_enum AS ENUM ('GMAIL', 'OUTLOOK');
ALTER TABLE email_links
    ALTER COLUMN provider TYPE email_user_provider_enum
    USING provider::text::email_user_provider_enum;
ALTER TABLE email_links_history
    ALTER COLUMN provider TYPE email_user_provider_enum
    USING provider::text::email_user_provider_enum;
ALTER TABLE in_progress_user_link
    ALTER COLUMN email_provider TYPE email_user_provider_enum
    USING email_provider::text::email_user_provider_enum;
DROP TYPE email_user_provider_enum_with_rox;
ALTER TABLE in_progress_user_link
    ALTER COLUMN email_provider SET DEFAULT 'GMAIL'::email_user_provider_enum;
CREATE UNIQUE INDEX email_links_outlook_identity
    ON email_links (provider_tenant_id, provider_mailbox_id)
    WHERE provider = 'OUTLOOK'::email_user_provider_enum
      AND provider_tenant_id IS NOT NULL
      AND provider_mailbox_id IS NOT NULL;
