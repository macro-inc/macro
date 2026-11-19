SET LOCAL lock_timeout = '5s';

-- Keep excluded folders in the role catalog while pausing their synchronization feeds.
ALTER TABLE email_mailbox_folders
    ADD COLUMN sync_enabled boolean NOT NULL DEFAULT true;
