-- Give the new column statistics now. Without them the planner guesses that
-- `mailbox_unavailable_at IS NULL` matches 0.5% of links instead of nearly
-- all, and the Outlook sync claims that filter on it switch to plans that
-- read every link, until autovacuum next analyzes the table. Its own
-- migration, so the column's ACCESS EXCLUSIVE lock is not held meanwhile;
-- ANALYZE takes SHARE UPDATE EXCLUSIVE, which writes do not wait on.
SET LOCAL lock_timeout = '5s';
ANALYZE email_links (mailbox_unavailable_at);
