-- AI allowances are now measured at provider cost: every paid seat includes
-- INCLUDED_ALLOWANCE_CENTS ($20) of cost per period (crates/ai_billing/src/domain/pricing.rs).
-- Frozen per-period rosters were written in the retired 2.5x list-rate unit
-- (4000 / 20000). Rewrite the amounts, keep the rosters: closed-period settlement
-- still needs to know who was billed, and the open period re-freezes on its
-- next observation anyway. Billing has never been enabled in production, so no
-- customer amount changes; previously booked credits and charges stay booked.
UPDATE ai_billing_period_allowance
SET included_cents_by_user = array_fill(2000::bigint, ARRAY[cardinality(billed_users)]),
    updated_at = NOW()
WHERE included_cents_by_user IS DISTINCT FROM array_fill(2000::bigint, ARRAY[cardinality(billed_users)]);
