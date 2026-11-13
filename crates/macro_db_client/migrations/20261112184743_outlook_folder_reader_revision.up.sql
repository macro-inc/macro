-- The folder reader revision (`FolderChangeReader::READER_REVISION`) a mail
-- folder stream's current delta round started at, stamped by the round's
-- first page. NULL for rounds started before it was recorded. A stream whose
-- round started at an older revision is due a re-import
-- (`reimport_outlook_folders`).
-- Adding a nullable column without a default rewrites no rows; the short
-- lock timeout keeps the sync workers' claims from queueing behind it on this
-- busy table.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_sync_streams ADD COLUMN reader_revision SMALLINT;
