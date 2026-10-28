-- Per-seat plan history survives departure/deletion, like ai_billing_account.
-- Additive: existing binaries can continue recording usage without this table.
CREATE TABLE ai_billing_plan_change (
    user_id TEXT NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL,
    previous_plan TEXT NOT NULL CHECK (previous_plan IN ('free', 'premium', 'max')),
    new_plan TEXT NOT NULL CHECK (new_plan IN ('free', 'premium', 'max')),
    previous_included_cost_cents BIGINT CHECK (previous_included_cost_cents >= 0),
    new_included_cost_cents BIGINT CHECK (new_included_cost_cents >= 0),
    PRIMARY KEY (user_id, period_start, changed_at, previous_plan, new_plan),
    CHECK (changed_at >= period_start),
    CHECK (previous_plan <> new_plan),
    CHECK ((previous_plan = 'free') = (previous_included_cost_cents IS NULL)),
    CHECK ((new_plan = 'free') = (new_included_cost_cents IS NULL))
);
