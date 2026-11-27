-- no-transaction
-- The legacy directory page orders the owner's inbox contacts in the default
-- collation, to merge them with contacts_connections under one cursor. The
-- primary key is C-collated, so without this index each page sorts all of
-- the owner's rows; with it, a page is a range read after the cursor.
-- If a build was interrupted, it leaves an INVALID index behind and the next
-- run fails on the name: drop the INVALID index by hand and run again. Check:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY contact_inbox_members_owner_default_order_idx
    ON contact_inbox_members (user_id, (contact_user_id COLLATE "default"));
