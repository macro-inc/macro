-- Validate the plan history checks widened for the Business plan in the
-- previous migration. VALIDATE takes SHARE UPDATE EXCLUSIVE, which does not
-- block writes, and runs here so the scan does not extend that migration's
-- ACCESS EXCLUSIVE lock.
SET lock_timeout = '5s';

ALTER TABLE ai_billing_plan_change
    VALIDATE CONSTRAINT ai_billing_plan_change_previous_plan_check;
ALTER TABLE ai_billing_plan_change
    VALIDATE CONSTRAINT ai_billing_plan_change_new_plan_check;
