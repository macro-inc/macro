-- Sync work of a superseded generation can never be claimed (claims take the
-- link's current sync_generation, which never goes back), but it stayed due at
-- the front of the claim indexes, and every claim read past it. Generation
-- bumps now delete it; this deletes what earlier bumps left. Both tables are
-- queues for about a hundred Outlook links, a few thousand rows, and no
-- running query touches superseded rows, so this deletes in place.
DELETE FROM email_sync_streams s
USING email_links l
WHERE l.id = s.link_id AND s.generation < l.sync_generation;

DELETE FROM email_message_reconciliation q
USING email_links l
WHERE l.id = q.link_id AND q.generation < l.sync_generation;
