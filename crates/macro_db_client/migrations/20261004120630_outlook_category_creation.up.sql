ALTER TABLE email_mailbox_settings_work DROP CONSTRAINT email_mailbox_settings_work_kind_check;
ALTER TABLE email_mailbox_settings_work ADD CONSTRAINT email_mailbox_settings_work_kind_check
    CHECK (kind IN ('catalog','create_label','delete_label','sender_block'));
