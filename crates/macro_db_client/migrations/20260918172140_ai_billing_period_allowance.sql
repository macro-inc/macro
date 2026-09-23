-- Freeze each billing period's included allowance per billed user while the
-- period is still open. Settlement of a closed period reads this row instead
-- of the live entitlement, so a later plan or seat change cannot skip last
-- period's overage (upgrade) or charge usage that was included (downgrade).
--
-- Keyed by payer + period start, matching ai_overage_charge / credit
-- consumption. The service upserts the current period on each observation
-- (gate, snapshot, settle) and never writes a closed period's row.

CREATE TABLE ai_billing_period_allowance (
    user_id TEXT NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    billed_users TEXT[] NOT NULL,
    included_cents_by_user BIGINT[] NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, period_start),
    CHECK (cardinality(billed_users) = cardinality(included_cents_by_user))
);
