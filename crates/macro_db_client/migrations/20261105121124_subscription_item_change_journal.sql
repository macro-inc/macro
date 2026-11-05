-- Retain billing receipts independently of team/subscription deletion so a delayed
-- purchase replay cannot create a second charge. Owned by crates/teams.
CREATE TABLE subscription_item_change (
    idempotency_key TEXT PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    path TEXT NOT NULL,
    request JSONB NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'succeeded', 'payment_failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX subscription_item_change_pending_idx
    ON subscription_item_change (subscription_id) WHERE outcome = 'pending';
