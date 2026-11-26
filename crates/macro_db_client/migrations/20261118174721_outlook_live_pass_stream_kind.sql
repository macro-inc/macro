-- A folder in an Outlook import round gets a `mail_folder_live` stream beside
-- its `mail_folder` stream: a delta round that lists only mail received since
-- the import round started (the companion's `import_started_at`), so new mail
-- is stored while the import's walk goes on. The kind check is replaced NOT
-- VALID, so the ALTER holds its lock only briefly; 20261118174722 validates it
-- in its own transaction. Every kind the deployed code writes stays allowed.
SET LOCAL lock_timeout = '1s';
SET LOCAL statement_timeout = '5s';

ALTER TABLE email_sync_streams
    DROP CONSTRAINT email_sync_streams_kind_check,
    ADD CONSTRAINT email_sync_streams_kind_check CHECK (
        kind IN ('folder_catalog','mail_folder','mail_folder_live','gmail_history','gmail_backfill',
            'contacts','contacts_catalog','contacts_profile','calendar')
    ) NOT VALID;
