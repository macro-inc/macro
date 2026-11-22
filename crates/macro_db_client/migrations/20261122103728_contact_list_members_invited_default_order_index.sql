-- no-transaction
-- Same as contact_inbox_members_owner_default_order_idx, for the owner's
-- invited list, which the legacy directory page also merges under its cursor.
-- If a build was interrupted, it leaves an INVALID index behind and the next
-- run fails on the name: drop the INVALID index by hand and run again. Check:
--   SELECT indexrelid::regclass FROM pg_index WHERE NOT indisvalid;
CREATE INDEX CONCURRENTLY contact_list_members_invited_default_order_idx
    ON contact_list_members (user_id, (contact_user_id COLLATE "default"))
    WHERE list_key = 'invited';
