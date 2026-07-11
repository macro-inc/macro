-- Enforce that a user can only be an active participant in one call at a time.
-- Historical rows (left_at IS NOT NULL) are excluded, so users can freely
-- leave one call and join another.

CREATE UNIQUE INDEX IF NOT EXISTS call_participants_one_active_per_user
    ON call_participants (user_id)
    WHERE left_at IS NULL;
