use ai_billing::domain::{BillingError, Entitlement, EntitlementSource, PlanTier, UserPlan};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::EntitlementRoutinePlans;
use crate::domain::ports::RoutinePlans;

struct FixedPlan {
    plan: UserPlan,
}

impl EntitlementSource for FixedPlan {
    async fn entitlement(
        &self,
        _user: &MacroUserIdStr<'_>,
    ) -> ai_billing::domain::Result<Entitlement> {
        panic!("routine plan lookup must use user_plan, not the full team-roster entitlement read");
    }

    async fn user_plan(&self, _user: &MacroUserIdStr<'_>) -> ai_billing::domain::Result<UserPlan> {
        Ok(self.plan)
    }

    async fn stripe_customer_id(
        &self,
        _user: &MacroUserIdStr<'_>,
    ) -> ai_billing::domain::Result<Option<String>> {
        Ok(None)
    }

    async fn team_payer(
        &self,
        _team_id: Uuid,
    ) -> ai_billing::domain::Result<Option<MacroUserIdStr<'static>>> {
        Ok(None)
    }
}

struct FailingPlans;

impl EntitlementSource for FailingPlans {
    async fn entitlement(
        &self,
        _user: &MacroUserIdStr<'_>,
    ) -> ai_billing::domain::Result<Entitlement> {
        Err(BillingError::Entitlement(anyhow::anyhow!("db unavailable")))
    }

    async fn user_plan(&self, _user: &MacroUserIdStr<'_>) -> ai_billing::domain::Result<UserPlan> {
        Err(BillingError::Entitlement(anyhow::anyhow!("db unavailable")))
    }

    async fn stripe_customer_id(
        &self,
        _user: &MacroUserIdStr<'_>,
    ) -> ai_billing::domain::Result<Option<String>> {
        Ok(None)
    }

    async fn team_payer(
        &self,
        _team_id: Uuid,
    ) -> ai_billing::domain::Result<Option<MacroUserIdStr<'static>>> {
        Ok(None)
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap()
}

#[tokio::test]
async fn maps_each_seat_tier_without_reading_full_entitlement() {
    for tier in [
        PlanTier::Free,
        PlanTier::Premium,
        PlanTier::Business,
        PlanTier::Max,
    ] {
        let plans = EntitlementRoutinePlans::new(FixedPlan {
            plan: UserPlan {
                tier,
                unlimited: false,
            },
        });
        assert_eq!(plans.plan(&owner()).await.unwrap(), tier);
    }
}

#[tokio::test]
async fn enterprise_teams_count_as_max() {
    let plans = EntitlementRoutinePlans::new(FixedPlan {
        plan: UserPlan {
            tier: PlanTier::Premium,
            unlimited: true,
        },
    });
    assert_eq!(plans.plan(&owner()).await.unwrap(), PlanTier::Max);
}

#[tokio::test]
async fn propagates_billing_lookup_errors() {
    let plans = EntitlementRoutinePlans::new(FailingPlans);
    assert!(plans.plan(&owner()).await.is_err());
}
