-- no-transaction
CREATE UNIQUE INDEX CONCURRENTLY macro_user_claimed_handle_lower_key
    ON macro_user (lower(username))
    WHERE mailbox_handle_claimed_at IS NOT NULL;
