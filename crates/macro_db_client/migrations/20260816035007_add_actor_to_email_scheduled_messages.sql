-- The authenticated user who initiated the send, as a principal string
-- (`macro|…`). Nullable: rows created before this column (and provider-side
-- flows) have no recorded actor, and downstream consumers treat NULL as
-- "actor unknown" (no activity attribution).
ALTER TABLE email_scheduled_messages
    ADD COLUMN actor_id TEXT;
