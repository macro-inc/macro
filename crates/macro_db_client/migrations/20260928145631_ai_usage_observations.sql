-- Observational evidence is physically separate from authorized financial usage.
-- No funding references, handoff work, credit mutations or collection triggers.
CREATE TABLE ai_usage_observation (
    invocation_id uuid PRIMARY KEY,
    occurred_at timestamptz NOT NULL,
    request jsonb NOT NULL,
    finalization jsonb,
    finalized_at timestamptz
);

-- Discover interrupted attempts without scanning completed observations.
CREATE INDEX ai_usage_observation_pending_idx
    ON ai_usage_observation (occurred_at, invocation_id)
    WHERE finalization IS NULL;

-- Attribution is retained independently of user deletion, like the financial
-- journal. Retention/erasure is an explicit administrative operation, not a
-- cascading financial mutation. No prompts, responses or credentials are stored.
COMMENT ON TABLE ai_usage_observation IS
    'Nonfinancial per-attempt evidence; never a source of authorization or debt. Retain until explicit reviewed retention/erasure policy is applied.';
