-- Allow the Bitwarden zip export (`bitwarden_zip`) as an import format. The
-- format check is replaced NOT VALID, so the ALTER holds its lock only
-- briefly; 20261116193752 validates it in its own transaction. Every value
-- the deployed code writes stays allowed.
SET LOCAL lock_timeout = '2s';

ALTER TABLE password_import_activity
    DROP CONSTRAINT password_import_activity_format_check,
    ADD CONSTRAINT password_import_activity_format_check CHECK (
        format IN ('one_password_pux','one_password_csv','bitwarden_json','bitwarden_csv','bitwarden_zip')
    ) NOT VALID;
