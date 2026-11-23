-- no-transaction
-- IMAP list-member pages seek only the owner's IMAP contacts from the cursor.
-- Keep the list key literal in the read so this partial index applies without
-- changing the plans of directory point lookups for other lists.
-- A no-transaction migration must contain one statement for CONCURRENTLY.
-- If an interrupted build leaves an INVALID index, drop it before retrying;
-- IF NOT EXISTS does not repair an existing invalid index.
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS contact_inbox_members_imap_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS contact_inbox_members_imap_idx
    ON contact_inbox_members (user_id, contact_user_id) WHERE list_key = 'imap';
