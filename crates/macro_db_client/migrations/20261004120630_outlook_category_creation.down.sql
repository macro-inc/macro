DELETE FROM email_mailbox_settings_work WHERE kind='create_label';
ALTER TABLE email_mailbox_settings_work DROP CONSTRAINT email_mailbox_settings_work_kind_check;
ALTER TABLE email_mailbox_settings_work ADD CONSTRAINT email_mailbox_settings_work_kind_check
    CHECK (kind IN ('catalog','delete_label','sender_block'));
