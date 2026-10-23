-- Channel thread pages sort by GREATEST(root.updated_at, latest live reply
-- updated_at). That value is computed per root, so the page reads every thread
-- in every channel the caller belongs to. Store it on the thread row the root
-- already owns. Nullable so the service that is deployed during this migration
-- can keep inserting thread rows without naming the column.
--
-- Kept apart from the backfill: ADD COLUMN takes ACCESS EXCLUSIVE, and holding
-- it while also locking comms_messages would deadlock with root inserts, which
-- take the two tables in the opposite order.
SET LOCAL lock_timeout = '5s';

ALTER TABLE comms_message_threads
    ADD COLUMN activity_at timestamptz;
