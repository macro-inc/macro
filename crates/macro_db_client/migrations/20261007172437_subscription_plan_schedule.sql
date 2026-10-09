-- Immutable provider schedule payloads. Stripe metadata holds only this row's
-- UUID, so large teams do not exceed Stripe's metadata size limits. Retain facts
-- through retries and delayed renewal webhooks.
CREATE TABLE subscription_plan_schedule (
    id UUID PRIMARY KEY,
    subscription_id TEXT NOT NULL,
    effective_at TIMESTAMPTZ NOT NULL,
    member_plans JSONB NOT NULL CHECK (jsonb_typeof(member_plans) = 'object')
);
