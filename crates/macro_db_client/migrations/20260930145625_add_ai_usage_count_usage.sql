ALTER TABLE ai_usage
    ADD COLUMN count_usage BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN ai_usage.count_usage IS
    'Prospective quota eligibility: true only for billable, user-owned usage recorded while AI usage enforcement is enabled. Historical rows and writers omitting this column remain false; never backfill them to true.';
