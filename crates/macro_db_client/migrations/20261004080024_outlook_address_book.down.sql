DROP TABLE email_contact_address_book_projection;
DROP TABLE email_address_book_sources;
DROP TABLE email_address_book_folders;
DELETE FROM email_sync_streams WHERE kind IN ('contacts_catalog','contacts_profile');
ALTER TABLE email_sync_streams DROP COLUMN scan_id;
ALTER TABLE email_sync_streams DROP CONSTRAINT email_sync_streams_kind_check;
ALTER TABLE email_sync_streams ADD CONSTRAINT email_sync_streams_kind_check CHECK
    (kind IN ('folder_catalog','mail_folder','gmail_history','gmail_backfill','contacts','calendar'));
