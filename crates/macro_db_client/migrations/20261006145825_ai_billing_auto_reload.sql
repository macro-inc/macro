-- AI billing: automatic credit reloads.
--
-- A payer who opts into overage ("extra usage") now also gets their prepaid
-- credit balance topped up automatically: when settlement sees the balance
-- about to drop below a per-payer minimum, it buys credits up to a per-payer
-- target through a one-off Stripe invoice, before any overage chunk would be
-- reserved. The thresholds live on ai_billing_account; the reloads themselves
-- are tracked in ai_credit_reload, mirroring ai_overage_charge.

-- ---------------------------------------------------------------------------
-- 1. Per-payer reload thresholds, in list-rate cents. Defaults match the
--    Usage page dialog ($10 minimum, $100 target, no monthly limit).
-- ---------------------------------------------------------------------------
ALTER TABLE ai_billing_account
    -- Reload when the credit balance (after this settlement) falls below this.
    ADD COLUMN auto_reload_minimum_cents BIGINT NOT NULL DEFAULT 1000,
    -- Reload brings the credit balance back up to this.
    ADD COLUMN auto_reload_target_cents BIGINT NOT NULL DEFAULT 10000,
    -- Cap on reload spend per UTC calendar month. NULL means no limit.
    ADD COLUMN auto_reload_monthly_limit_cents BIGINT,
    -- Set when a reload failed to collect; reloads stay off until the payer
    -- re-enables extra usage. Overage chunks remain the fallback meanwhile.
    ADD COLUMN auto_reload_suspended_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 2. Credit reloads pushed to Stripe, in list-rate cents. `pending` rows block
--    further reloads until Stripe resolves the invoice; `failed` rows suspend
--    automatic reloads for the payer.
-- ---------------------------------------------------------------------------
CREATE TYPE ai_credit_reload_status AS ENUM ('pending', 'paid', 'failed');

CREATE TABLE ai_credit_reload (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    amount_cents BIGINT NOT NULL,
    stripe_invoice_id TEXT,
    status ai_credit_reload_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ai_credit_reload_stripe_invoice_id_key
    ON ai_credit_reload (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX ai_credit_reload_user_id_created_at_idx
    ON ai_credit_reload (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Safety reset. Overage has not been deployed to users yet, and from now on
--    the overage opt-in also drives automatic reloads, so nobody should be
--    opted in without having seen the new terms. Turn it off everywhere; the
--    Usage page auto-reload dialog is the only way to turn it back on.
-- ---------------------------------------------------------------------------
UPDATE ai_billing_account
SET overage_enabled = FALSE,
    overage_limit_cents = 0,
    overage_suspended_at = NULL,
    updated_at = NOW()
WHERE overage_enabled
   OR overage_limit_cents <> 0
   OR overage_suspended_at IS NOT NULL;
