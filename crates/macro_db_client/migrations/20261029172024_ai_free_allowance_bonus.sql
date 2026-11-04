-- Extra monthly AI allowance a free user earns for invites and referrals.
-- Each row raises the free monthly allowance by `cost_cents` (provider cost);
-- the service caps the total it applies. Paid users get prepaid credit grants
-- in ai_credit_ledger instead. `id` is derived from the event that earned it,
-- so the same invite or referral never books twice.
CREATE TABLE ai_free_allowance_bonus (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    cost_cents BIGINT NOT NULL CHECK (cost_cents > 0),
    note TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_free_allowance_bonus_user ON ai_free_allowance_bonus (user_id);
