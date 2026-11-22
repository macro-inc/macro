-- no-transaction
-- Same as contact_inbox_members_owner_default_order_idx, for the owner's
-- invited list, which the legacy directory page also merges under its cursor.
CREATE INDEX CONCURRENTLY contact_list_members_invited_default_order_idx
    ON contact_list_members (user_id, (contact_user_id COLLATE "default"))
    WHERE list_key = 'invited';
