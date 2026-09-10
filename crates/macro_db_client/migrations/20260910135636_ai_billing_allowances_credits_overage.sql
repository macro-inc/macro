-- AI billing: plan allowances, prepaid credits, and post-paid overage.
--
-- Pricing model (see crates/ai_billing): every paid plan includes a monthly AI
-- allowance equal to its list price, measured at Macro's list rate. The list
-- rate is provider cost marked up so that a fully consumed allowance yields the
-- target gross margin (60% => 2.5x provider cost). Usage past the allowance is
-- covered by prepaid credits, then by opt-in overage billed to the payer's
-- Stripe customer in chunks.

-- ---------------------------------------------------------------------------
-- 1. The Max plan ($200/mo) gets its own subscription role. Like sub_opus it
--    grants the paid AI permission; professional_subscriber (added alongside
--    by the Stripe webhook) carries read:professional_features.
-- ---------------------------------------------------------------------------
INSERT INTO "Role" (id, description)
    VALUES ('sub_max', 'User is subscribed to the Max pricing plan')
ON CONFLICT DO NOTHING;

INSERT INTO "RolesOnPermissions" ("permissionId", "roleId")
    VALUES ('write:proai', 'sub_max')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Pricing seeds for models the chat selector already offers but that had no
--    ai_pricing row (their usage recorded a NULL price). USD per million tokens
--    from the Claude pricing catalog. ON CONFLICT keeps any runtime override.
-- ---------------------------------------------------------------------------
INSERT INTO ai_pricing (model, price_per_million_in, price_per_million_out) VALUES
    ('claude-sonnet-5', 2.0, 10.0),
    ('claude-fable-5-1', 10.0, 50.0)
ON CONFLICT (model) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Chat recorded the provider-qualified routing id ("anthropic/claude-opus-5")
--    while ai_pricing is keyed by the bare api id ("claude-opus-5"), so most
--    chat rows never resolved a price. The recorder now normalizes to the bare
--    id before pricing; normalize the history the same way and backfill the
--    price of every row that can now be priced.
-- ---------------------------------------------------------------------------
UPDATE ai_usage
SET model = split_part(model, '/', 2)
WHERE model LIKE '%/%'
  AND split_part(model, '/', 2) <> '';

UPDATE ai_usage u
SET price_per_million_in = p.price_per_million_in,
    price_per_million_out = p.price_per_million_out,
    total = (u.input_tokens::real / 1000000.0::real) * p.price_per_million_in
          + (u.output_tokens::real / 1000000.0::real) * p.price_per_million_out
FROM ai_pricing p
WHERE u.model = p.model
  AND u.total IS NULL;

-- Per-user, per-period sums are the hot billing query. The composite index
-- covers the old single-column user_id index (CS-06), so replace it.
CREATE INDEX ai_usage_user_id_created_at_idx ON ai_usage (user_id, created_at DESC);
DROP INDEX IF EXISTS ai_usage_user_id_idx;

-- ---------------------------------------------------------------------------
-- 4. Billing state, keyed by the *payer*: the personal subscriber, or the team
--    owner for members whose paid access comes through a team subscription.
--    Rows are created lazily on first read/write; absence means defaults.
-- ---------------------------------------------------------------------------
CREATE TABLE ai_billing_account (
    user_id TEXT PRIMARY KEY,
    -- Opt-in: bill usage past the allowance and credits to the Stripe customer.
    overage_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    -- Per-period cap on overage spend, in list-rate cents. 0 means no overage.
    overage_limit_cents BIGINT NOT NULL DEFAULT 0,
    -- Set when an overage charge failed to collect; overage stays off until the
    -- payer re-enables it (which retries collection).
    overage_suspended_at TIMESTAMPTZ,
    -- The current Stripe subscription period, synced from webhooks. NULL falls
    -- back to the UTC calendar month.
    period_start TIMESTAMPTZ,
    period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prepaid credit ledger, in list-rate cents. The balance is the sum of deltas.
CREATE TYPE ai_credit_entry_kind AS ENUM ('purchase', 'consumption', 'grant', 'adjustment');

CREATE TABLE ai_credit_ledger (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind ai_credit_entry_kind NOT NULL,
    -- Positive for purchases/grants, negative for consumption.
    delta_cents BIGINT NOT NULL,
    -- For consumption entries: the usage period the credits were applied to.
    period_start TIMESTAMPTZ,
    -- Stripe Checkout Session id for purchases; unique so webhook retries are
    -- idempotent.
    stripe_reference TEXT,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ai_credit_ledger_stripe_reference_key
    ON ai_credit_ledger (stripe_reference) WHERE stripe_reference IS NOT NULL;
CREATE INDEX ai_credit_ledger_user_id_created_at_idx
    ON ai_credit_ledger (user_id, created_at DESC);

-- Overage charges pushed to Stripe, in list-rate cents. `failed` charges do not
-- count as covered usage and suspend further overage for the payer.
CREATE TYPE ai_overage_charge_status AS ENUM ('pending', 'paid', 'failed');

CREATE TABLE ai_overage_charge (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    amount_cents BIGINT NOT NULL,
    stripe_invoice_id TEXT,
    status ai_overage_charge_status NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX ai_overage_charge_stripe_invoice_id_key
    ON ai_overage_charge (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;
CREATE INDEX ai_overage_charge_user_id_period_start_idx
    ON ai_overage_charge (user_id, period_start);
