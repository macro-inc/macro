ALTER TABLE public.email_messages
    ADD COLUMN from_name VARCHAR(255);

ALTER TABLE public.email_message_recipients
    ADD COLUMN name VARCHAR(255);
