-- Run after the short DDL transaction. This only changes routing metadata;
-- work identities, generations, leases and content are preserved. Include
-- inactive links and Gmail cleanup rows, not only active IMAP connections.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

UPDATE public.email_sync_streams s
SET provider = l.provider
FROM public.email_links l
WHERE l.id = s.link_id
    AND s.provider IS DISTINCT FROM l.provider;

UPDATE public.email_message_reconciliation q
SET provider = l.provider
FROM public.email_links l
WHERE l.id = q.link_id
    AND q.provider IS DISTINCT FROM l.provider;
