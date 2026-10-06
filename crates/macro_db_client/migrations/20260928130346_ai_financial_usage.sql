-- Prospective financial evidence only. Never backfill from mutable ai_usage/ai_pricing.
-- No user/entity FK: account deletion must not cascade away financial evidence.
-- Retention: keep finalized evidence at least seven years and while any funding work,
-- dispute, or legal hold is outstanding; keep unresolved work and referenced rates
-- indefinitely. No automatic purge is enabled. A separately reviewed archival process
-- must preserve replay identity before any future retention migration permits deletion.
CREATE TABLE ai_financial_rate (
    version UUID PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    effective_at TIMESTAMPTZ NOT NULL,
    valid_until TIMESTAMPTZ NOT NULL CHECK (valid_until > effective_at),
    publication JSONB NOT NULL CHECK (jsonb_typeof(publication) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider, model, effective_at)
);
COMMENT ON TABLE ai_financial_rate IS
    'Append-only reviewed public rates and cache/reasoning provenance, never analytics pricing. No seeded or inferred rates.';

CREATE TABLE ai_financial_invocation (
    invocation_id UUID PRIMARY KEY,
    rate_version UUID NOT NULL REFERENCES ai_financial_rate(version) ON DELETE RESTRICT,
    occurred_at TIMESTAMPTZ NOT NULL,
    request JSONB NOT NULL CHECK (jsonb_typeof(request) = 'object'),
    funding JSONB CHECK (jsonb_typeof(funding) = 'object'),
    finalization JSONB CHECK (jsonb_typeof(finalization) = 'object'),
    recovery_required BOOLEAN NOT NULL DEFAULT true,
    funding_acknowledged BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finalized_at TIMESTAMPTZ,
    CHECK (finalization IS NULL OR funding IS NOT NULL),
    CHECK ((finalization IS NULL) = (finalized_at IS NULL)),
    CHECK (NOT funding_acknowledged OR finalization IS NOT NULL),
    CHECK (finalization IS NOT NULL OR recovery_required)
);
COMMENT ON TABLE ai_financial_invocation IS
    'Immutable typed request, disjoint token counts and valuation. No prompts, outputs, raw token text or credentials. No historical debt backfill.';

-- Stable-ID bounded recovery scans, including crashes before authorization and after
-- evidence commit but before the funding owner acknowledges the handoff.
CREATE INDEX ai_financial_invocation_recovery_idx
    ON ai_financial_invocation (invocation_id, occurred_at)
    WHERE funding IS NOT NULL AND (recovery_required OR NOT funding_acknowledged);
CREATE INDEX ai_financial_invocation_admission_idx
    ON ai_financial_invocation (invocation_id, occurred_at) WHERE funding IS NULL;

CREATE FUNCTION ai_financial_rate_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'financial rate publications are immutable';
END;
$$;
CREATE TRIGGER ai_financial_rate_immutable
    BEFORE UPDATE OR DELETE ON ai_financial_rate
    FOR EACH ROW EXECUTE FUNCTION ai_financial_rate_immutable();

CREATE FUNCTION ai_financial_invocation_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'financial invocation retention requires explicit archival';
    END IF;
    IF NEW.invocation_id IS DISTINCT FROM OLD.invocation_id
        OR NEW.rate_version IS DISTINCT FROM OLD.rate_version
        OR NEW.occurred_at IS DISTINCT FROM OLD.occurred_at
        OR NEW.request IS DISTINCT FROM OLD.request
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR (OLD.funding IS NOT NULL AND NEW.funding IS DISTINCT FROM OLD.funding)
        OR (OLD.finalization IS NOT NULL AND
            (NEW.finalization IS DISTINCT FROM OLD.finalization
             OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at
             OR NEW.recovery_required IS DISTINCT FROM OLD.recovery_required))
        OR (OLD.funding_acknowledged AND NOT NEW.funding_acknowledged)
    THEN
        RAISE EXCEPTION 'financial invocation facts are immutable';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER ai_financial_invocation_immutable
    BEFORE UPDATE OR DELETE ON ai_financial_invocation
    FOR EACH ROW EXECUTE FUNCTION ai_financial_invocation_immutable();
