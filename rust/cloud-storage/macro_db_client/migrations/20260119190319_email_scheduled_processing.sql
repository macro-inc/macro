ALTER TABLE email_scheduled_messages
    ADD COLUMN processing BOOLEAN NOT NULL DEFAULT false;