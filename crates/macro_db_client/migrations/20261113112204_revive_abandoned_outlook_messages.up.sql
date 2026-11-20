-- Queues every abandoned Outlook message reconciliation again, so the decoder
-- that accepts a sender or recipient without an address reads it. It must run
-- only once that decoder is live: migrations run before the services roll out.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
UPDATE email_message_reconciliation q
SET available_at = now()
FROM email_links l
WHERE q.is_import IN (false, true)
    AND q.available_at = 'infinity'
    AND l.id = q.link_id
    AND l.provider = 'OUTLOOK'
    AND q.generation = l.sync_generation;
