-- no-transaction
-- The legacy directory page orders the owner's inbox contacts in the default
-- collation, to merge them with contacts_connections under one cursor. The
-- primary key is C-collated, so without this index each page sorts all of
-- the owner's rows; with it, a page is a range read after the cursor.
CREATE INDEX CONCURRENTLY contact_inbox_members_owner_default_order_idx
    ON contact_inbox_members (user_id, (contact_user_id COLLATE "default"));
