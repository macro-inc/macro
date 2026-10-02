-- Inbox triage on an email thread (mark done, trash, spam) used to be recorded
-- as an `edited` activity. The email domain no longer records it, but the rows
-- already written keep the threads in every own-touch surface — Home merges
-- that feed, so threads the user dismissed sit in it at the time they were
-- dismissed.
--
-- Drop those facts for threads that are out of the inbox today. Rows for
-- threads still in the inbox stay: there the `edited` fact came from a star or
-- a label change on a thread the user is still working.
DELETE FROM activity_events ae
USING email_threads t
WHERE ae.entity_type = 'email_thread'
  AND ae.action = 'edited'
  AND t.id::text = ae.entity_id
  AND NOT t.inbox_visible;
