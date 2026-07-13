ALTER TABLE email_messages
DROP CONSTRAINT email_messages_replying_to_id_fkey;

ALTER TABLE email_messages
    ADD CONSTRAINT email_messages_replying_to_id_fkey
        FOREIGN KEY (replying_to_id)
            REFERENCES email_messages(id)
            ON DELETE SET NULL;