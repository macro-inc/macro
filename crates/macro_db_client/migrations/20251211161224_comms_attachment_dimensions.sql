-- Add migration script here
ALTER TABLE public.comms_attachments
    ADD COLUMN width integer,
ADD COLUMN height integer;