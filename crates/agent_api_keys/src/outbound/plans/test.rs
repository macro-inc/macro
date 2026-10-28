use ai_billing::domain::{BillingError, Entitlement, PlanTier};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::*;

const OWNER: &str = "macro|owner@example.com";

/// Every user is on `tier`; every team is paid for by [`OWNER`].
struct Plans {
    tier: PlanTier,
    unlimited: bool,
    team_has_payer: bool,
}

impl EntitlementSource for Plans {
    async fn entitlement(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> std::result::Result<Entitlement, BillingError> {
        Ok(Entitlement {
            unlimited: self.unlimited,
            ..Entitlement::personal(
                MacroUserIdStr::try_from(user.as_ref().to_owned()).expect("user id"),
                self.tier,
            )
        })
    }

    async fn stripe_customer_id(
        &self,
        _user: &MacroUserIdStr<'_>,
    ) -> std::result::Result<Option<String>, BillingError> {
        Ok(None)
    }

    async fn team_payer(
        &self,
        _team_id: Uuid,
    ) -> std::result::Result<Option<MacroUserIdStr<'static>>, BillingError> {
        Ok(self
            .team_has_payer
            .then(|| MacroUserIdStr::try_from(OWNER.to_owned()).expect("user id")))
    }
}

#[tokio::test]
async fn only_paid_and_enterprise_plans_include_agent_keys() {
    let person = AgentOwner::User(MacroUserIdStr::try_from(OWNER.to_owned()).expect("user id"));
    let team = AgentOwner::Team(Uuid::nil());
    for (tier, unlimited, allowed) in [
        (PlanTier::Free, false, false),
        (PlanTier::Premium, false, true),
        (PlanTier::Max, false, true),
        (PlanTier::Free, true, true),
    ] {
        let plans = EntitlementKeyPlans::new(Plans {
            tier,
            unlimited,
            team_has_payer: true,
        });
        for owner in [&person, &team] {
            assert_eq!(
                plans.allows_keys(owner).await.expect("plan read"),
                allowed,
                "{tier:?}, unlimited {unlimited}, {owner:?}"
            );
        }
    }
}

#[tokio::test]
async fn a_team_without_a_payer_has_no_agent_keys() {
    let plans = EntitlementKeyPlans::new(Plans {
        tier: PlanTier::Max,
        unlimited: false,
        team_has_payer: false,
    });
    assert!(
        !plans
            .allows_keys(&AgentOwner::Team(Uuid::nil()))
            .await
            .expect("plan read")
    );
}
