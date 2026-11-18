-- How far a mail folder still in its first delta round has been checked for
-- newly received mail: a round lists only what the folder held when it
-- started, so mail arriving meanwhile is listed by a sweep of the folder's
-- recent mail instead (`MailboxSyncService::sweep`). The round's first
-- page stamps the time its lease started, each sweep the time of its own;
-- the round's checkpoint clears it. NULL for folders whose first round is
-- done, and until the next page of a round started before this column.
-- Adding a nullable column without a default rewrites no rows; the short
-- lock timeout keeps the sync workers' claims from queueing behind it on this
-- busy table.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_sync_streams ADD COLUMN swept_at TIMESTAMPTZ;
