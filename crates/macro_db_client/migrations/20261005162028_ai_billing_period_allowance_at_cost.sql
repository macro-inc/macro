-- AI allowances are now measured at provider cost: every paid seat includes
-- INCLUDED_ALLOWANCE_CENTS ($20) of cost per period (crates/ai_billing/src/domain/pricing.rs).
--
-- Frozen per-period rosters in ai_billing_period_allowance.included_cents_by_user
-- were written in the retired list-rate unit. This migration runs before the new
-- binary and must stay readable by the one still deployed, so it only adds a
-- column: the new binary writes cost cents here (and mirrors them into the legacy
-- column, which stays NOT NULL for the old binary), reads this column when it is
-- present and matches the roster, and otherwise prices every frozen seat at the
-- current allowance. Rows the old binary writes leave it NULL. Drop the legacy
-- column in a later migration once no pre-cutover binary can run.
ALTER TABLE ai_billing_period_allowance
    ADD COLUMN included_cost_cents_by_user BIGINT[];
