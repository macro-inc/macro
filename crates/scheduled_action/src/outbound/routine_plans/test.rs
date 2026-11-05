use ai_billing::domain::{BillingError, Entitlement, EntitlementSource, PlanTier};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::EntitlementRoutinePlans;
use crate::domain::ports::RoutinePlans;

struct Entitled {
    tier: PlanTier,
    unlimited: bool,
}

impl EntitlementSource for Entitled {
    async fn entitlement(&self, user: &MacroUserIdStr<'_>) -> Result<Entitlement, BillingError> {
        Ok(Entitlement {
            unlimited: self.unlimited,
            ..Entitlement::personal(
                MacroUserIdStr::try_from(user.as_ref().to_owned()).unwrap(),
                self.tier,
            )
        })
    }

    async fn stripe_customer_id(
        &self,
        _user: &MacroUserIdStr<'_>,
    ) -> Result<Option<String>, BillingError> {
        Ok(None)
    }

    async fn team_payer(
        &self,
        _team_id: Uuid,
    ) -> Result<Option<MacroUserIdStr<'static>>, BillingError> {
        Ok(None)
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|routine-owner@macro.com".to_owned()).unwrap()
}

#[tokio::test]
async fn an_owners_seat_plan_applies() {
    for tier in [PlanTier::Free, PlanTier::Premium, PlanTier::Max] {
        let plans = EntitlementRoutinePlans::new(Entitled {
            tier,
            unlimited: false,
        });
        assert_eq!(plans.plan(&owner()).await.unwrap(), tier);
    }
}

#[tokio::test]
async fn an_enterprise_member_gets_max() {
    let plans = EntitlementRoutinePlans::new(Entitled {
        tier: PlanTier::Premium,
        unlimited: true,
    });
    assert_eq!(plans.plan(&owner()).await.unwrap(), PlanTier::Max);
}
