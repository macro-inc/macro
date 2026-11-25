-- no-transaction
-- Answers whether a mailbox has a folder in its import round, which a change
-- notification checks before it queues the message it names
-- (`queue_notified_message`). The unique key reads every folder stream of the
-- mailbox, and every notification has just written a new version of each,
-- so the check would read them all under the link's row lock. Import rounds
-- are few, so this index is small. The predicate must match the query's.
-- Single statement: CONCURRENTLY forbids the implicit transaction of a
-- batch. No IF NOT EXISTS, so an INVALID index left by an interrupted build
-- fails the next run instead of passing: drop it by hand and run again.
-- Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY email_sync_streams_link_import_rounds
    ON email_sync_streams (link_id, generation)
    WHERE kind = 'mail_folder' AND NOT initial_complete;
