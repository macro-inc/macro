-- Restore the four-format check. NOT VALID keeps any `bitwarden_zip` audit
-- rows written meanwhile instead of failing or deleting them; new rows are
-- checked.
SET LOCAL lock_timeout = '2s';

ALTER TABLE password_import_activity
    DROP CONSTRAINT password_import_activity_format_check,
    ADD CONSTRAINT password_import_activity_format_check CHECK (
        format IN ('one_password_pux','one_password_csv','bitwarden_json','bitwarden_csv')
    ) NOT VALID;
