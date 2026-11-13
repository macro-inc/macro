-- How many items Graph counted in each Outlook folder when the folder
-- catalog last listed it, so an import can be checked against the provider:
-- the folder holds that many messages whether or not they have been
-- imported. NULL until the next catalog discovery lists the folder.
-- Adding a nullable column without a default rewrites no rows; the short
-- lock timeout keeps catalog commits from queueing behind it.
SET LOCAL lock_timeout = '5s';
ALTER TABLE email_mailbox_folders ADD COLUMN total_item_count BIGINT;
