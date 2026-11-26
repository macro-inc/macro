-- no-transaction
-- Pages of the invited list (GET /contacts/lists/invited/members) seek the
-- owner's rows from the cursor among that list's rows only. The primary key holds
-- list_key after contact_user_id, so without this index a page of a small list
-- (invited next to many interacted rows) walks every list the owner has.
-- Partial, one index per list, so that only the list-members reads, which
-- name the list as a literal, can use it. An index on
-- (user_id, list_key, contact_user_id) took the directory's point lookups
-- (user_id = $1 AND contact_user_id = $2) from the primary key in Postgres 14
-- generic plans and walked the owner's whole range for each id.
-- Must stay a single statement: sqlx sends no-transaction migrations as one
-- simple-query batch, and a multi-statement batch gets an implicit
-- transaction, which CONCURRENTLY forbids. If an interrupted deploy leaves an
-- INVALID index behind, IF NOT EXISTS will not rebuild it -- drop it by hand
-- and re-run. Check with:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
-- Rollback: DROP INDEX CONCURRENTLY IF EXISTS contact_list_members_invited_idx;
CREATE INDEX CONCURRENTLY IF NOT EXISTS contact_list_members_invited_idx
    ON contact_list_members (user_id, contact_user_id) WHERE list_key = 'invited';
