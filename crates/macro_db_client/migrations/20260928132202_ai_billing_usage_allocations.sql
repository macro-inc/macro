-- Additive, prospective accounting only. No historical usage or debt is backfilled.
-- Financial records deliberately RESTRICT deletion: retention/redaction must be an
-- explicit audited operation, never a cascade from membership or account deletion.
ALTER TABLE ai_billing_account ADD COLUMN authorization_revision BIGINT NOT NULL DEFAULT 0;
CREATE FUNCTION ai_billing_bump_authorization_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.overage_enabled, NEW.overage_limit_cents, NEW.overage_suspended_at)
       IS DISTINCT FROM (OLD.overage_enabled, OLD.overage_limit_cents, OLD.overage_suspended_at) THEN
        NEW.authorization_revision := OLD.authorization_revision + 1;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ai_billing_authorization_revision BEFORE UPDATE ON ai_billing_account
FOR EACH ROW EXECUTE FUNCTION ai_billing_bump_authorization_revision();

CREATE TABLE ai_billing_usage_period (
    user_id TEXT NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL CHECK (period_end > period_start),
    payer_id TEXT NOT NULL REFERENCES ai_billing_account(user_id) ON DELETE RESTRICT,
    subscription_id TEXT NOT NULL CHECK (length(subscription_id) > 0),
    policy TEXT NOT NULL CHECK (policy IN ('legacy', 'public_allowance_v1')),
    PRIMARY KEY (user_id, period_start)
);
CREATE INDEX ai_billing_usage_period_payer ON ai_billing_usage_period(payer_id, period_start);

CREATE TABLE ai_funding_state (
    user_id TEXT PRIMARY KEY REFERENCES ai_billing_account(user_id) ON DELETE RESTRICT,
    next_sequence BIGINT NOT NULL DEFAULT 0 CHECK (next_sequence >= 0),
    watermark BIGINT NOT NULL DEFAULT 0 CHECK (watermark BETWEEN 0 AND next_sequence),
    -- Whole cents have already been debited from the existing ledger. This exact
    -- remainder is still unavailable; it must not become spendable after a restart.
    prepaid_remainder BIGINT NOT NULL DEFAULT 0 CHECK (prepaid_remainder >= 0 AND prepaid_remainder < 1000000000000)
);

-- An explicit funding rejection is terminal for this invocation identity. Retrying
-- after a purchase/toggle requires a NEW provider attempt, never funding old history.
-- Infrastructure failures roll back and remain safely retryable through the journal.
CREATE TABLE ai_funding_intent (
    invocation_id UUID PRIMARY KEY,
    identity JSONB NOT NULL,
    denied BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_funding_reservation (
    invocation_id UUID PRIMARY KEY REFERENCES ai_funding_intent(invocation_id) ON DELETE RESTRICT,
    authorization_id UUID NOT NULL UNIQUE,
    payer_id TEXT NOT NULL REFERENCES ai_funding_state(user_id) ON DELETE RESTRICT,
    sequence BIGINT NOT NULL CHECK (sequence >= 0),
    user_id TEXT NOT NULL,
    period_start TIMESTAMPTZ NOT NULL,
    -- Immutable original availability, settings, budget and request/rate identity.
    admission JSONB NOT NULL,
    included_hold BIGINT NOT NULL CHECK (included_hold >= 0),
    prepaid_hold BIGINT NOT NULL CHECK (prepaid_hold >= 0),
    postpaid_hold BIGINT NOT NULL CHECK (postpaid_hold >= 0),
    -- Completion is a write-once handoff receipt. NULL actual is unresolved, NOT zero.
    completion JSONB,
    actual_public BIGINT CHECK (actual_public >= 0),
    allocated BOOLEAN NOT NULL DEFAULT FALSE,
    included_public BIGINT NOT NULL DEFAULT 0 CHECK (included_public >= 0),
    extra_public BIGINT NOT NULL DEFAULT 0 CHECK (extra_public >= 0),
    prepaid BIGINT NOT NULL DEFAULT 0 CHECK (prepaid >= 0),
    reclaimed_prepaid BIGINT NOT NULL DEFAULT 0 CHECK (reclaimed_prepaid BETWEEN 0 AND prepaid),
    postpaid BIGINT NOT NULL DEFAULT 0 CHECK (postpaid >= 0),
    macro_absorbed BIGINT NOT NULL DEFAULT 0 CHECK (macro_absorbed >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (payer_id, sequence),
    FOREIGN KEY (user_id, period_start) REFERENCES ai_billing_usage_period(user_id, period_start) ON DELETE RESTRICT,
    CHECK (NOT allocated OR (completion IS NOT NULL AND actual_public IS NOT NULL)),
    CHECK (NOT allocated OR actual_public = included_public + extra_public)
);
CREATE INDEX ai_funding_reservation_period ON ai_funding_reservation(payer_id, period_start);
CREATE INDEX ai_funding_reservation_work ON ai_funding_reservation(invocation_id) WHERE NOT allocated;
CREATE INDEX ai_funding_reservation_holds ON ai_funding_reservation(payer_id, sequence) WHERE NOT allocated;

-- Released prepaid holds are kept unavailable to new admissions until all the
-- admissions that could reclaim them have passed the allocation watermark.
CREATE TABLE ai_funding_prepaid_release (
    payer_id TEXT NOT NULL REFERENCES ai_funding_state(user_id) ON DELETE RESTRICT,
    sequence BIGINT NOT NULL,
    through_sequence BIGINT NOT NULL CHECK (through_sequence >= sequence),
    units BIGINT NOT NULL CHECK (units > 0),
    PRIMARY KEY (payer_id, sequence),
    FOREIGN KEY (payer_id, sequence) REFERENCES ai_funding_reservation(payer_id, sequence) ON DELETE RESTRICT
);

-- Keep new consumption out of legacy aggregate coverage. Old writers retain
-- their original semantics and defaults. The invocation key prevents duplicate debit.
ALTER TABLE ai_credit_ledger ADD COLUMN funding_invocation_id UUID UNIQUE
    REFERENCES ai_funding_reservation(invocation_id) ON DELETE RESTRICT;

-- The collection worker must label invoices backed by V1 allocations. Those
-- invoices must not also become legacy coverage or count twice against the cap.
ALTER TABLE ai_overage_charge ADD COLUMN accounting_policy TEXT NOT NULL DEFAULT 'legacy'
    CHECK (accounting_policy IN ('legacy', 'public_allowance_v1'));
