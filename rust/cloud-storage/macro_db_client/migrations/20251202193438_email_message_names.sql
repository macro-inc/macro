ALTER TABLE public.email_messages
    ADD COLUMN from_name VARCHAR(255);

ALTER TABLE public.email_message_recipients
    ADD COLUMN name VARCHAR(255);

UPDATE public.email_messages m
SET from_name = c.name
    FROM public.email_contacts c
WHERE m.from_contact_id = c.id
  AND m.from_name IS NULL;

UPDATE public.email_message_recipients mr
SET name = c.name
    FROM public.email_contacts c
WHERE mr.contact_id = c.id
  AND mr.name IS NULL;