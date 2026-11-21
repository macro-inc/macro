-- Widen the provider vocabulary without scanning while holding DDL locks.
-- Existing producers still write the same Gmail/Outlook keys. Update contacts
-- consumers before enabling IMAP list publication; no row backfill is needed.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE public.contact_inbox_members
    ADD CONSTRAINT contact_inbox_members_list_key_imap_check
    CHECK (list_key IN ('gmail', 'outlook', 'imap'))
    NOT VALID;

ALTER TABLE public.contact_inbox_members
    DROP CONSTRAINT contact_inbox_members_list_key_check;

ALTER TABLE public.contact_inbox_members
    RENAME CONSTRAINT contact_inbox_members_list_key_imap_check
    TO contact_inbox_members_list_key_check;
