-- The Business plan ($80/seat/month billed annually, $90 month to month):
-- a seat plan between Premium and Max with its own subscription role.
--
-- Additive for running binaries: they skip unknown role ids, and no row uses
-- the new seat plan value until the new code sells it.
SET lock_timeout = '5s';

-- Like sub_opus and sub_max, sub_business grants the paid AI permission;
-- professional_subscriber (added alongside by the Stripe webhook) carries
-- read:professional_features.
INSERT INTO "Role" (id, description)
    VALUES ('sub_business', 'User is subscribed to the Business pricing plan')
ON CONFLICT DO NOTHING;

INSERT INTO "RolesOnPermissions" ("permissionId", "roleId")
    VALUES ('write:proai', 'sub_business')
ON CONFLICT DO NOTHING;

ALTER TYPE "seat_plan" ADD VALUE IF NOT EXISTS 'business' BEFORE 'max';

-- Plan history records Business changes too. NOT VALID skips the scan under
-- the ACCESS EXCLUSIVE lock; the next migration validates existing rows in
-- its own transaction, under a lock that does not block writes.
ALTER TABLE ai_billing_plan_change
    DROP CONSTRAINT ai_billing_plan_change_previous_plan_check,
    DROP CONSTRAINT ai_billing_plan_change_new_plan_check,
    ADD CONSTRAINT ai_billing_plan_change_previous_plan_check
        CHECK (previous_plan IN ('free', 'premium', 'business', 'max')) NOT VALID,
    ADD CONSTRAINT ai_billing_plan_change_new_plan_check
        CHECK (new_plan IN ('free', 'premium', 'business', 'max')) NOT VALID;
