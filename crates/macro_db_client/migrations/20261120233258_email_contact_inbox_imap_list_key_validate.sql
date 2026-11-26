-- Validate separately so the row scan does not retain the widening migration's
-- exclusive locks. Old rows already satisfy the strictly wider check.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

ALTER TABLE public.contact_inbox_members
    VALIDATE CONSTRAINT contact_inbox_members_list_key_check;
