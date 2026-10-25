use super::*;
use crate::domain::{Entitlement, PayerScope};
use std::sync::Mutex;

struct OneEntitlement(Entitlement);

impl EntitlementSource for OneEntitlement {
    async fn entitlement(&self, _: &MacroUserIdStr<'_>) -> Result<Entitlement> {
        Ok(self.0.clone())
    }
    async fn stripe_customer_id(&self, _: &MacroUserIdStr<'_>) -> Result<Option<String>> {
        Ok(None)
    }
    async fn team_payer(&self, _: Uuid) -> Result<Option<MacroUserIdStr<'static>>> {
        Ok(None)
    }
}

#[derive(Default)]
struct RecordingRepo {
    booked: Mutex<Vec<(String, Uuid, u32)>>,
}

impl CreditGrantRepo for RecordingRepo {
    async fn record_credit_grant(
        &self,
        payer: &MacroUserIdStr<'_>,
        grant: &CreditGrant,
    ) -> Result<bool> {
        let mut booked = self.booked.lock().unwrap();
        if booked.iter().any(|(_, id, _)| *id == grant.id) {
            return Ok(false);
        }
        booked.push((
            payer.as_ref().to_string(),
            grant.id,
            grant.amount_cents.get(),
        ));
        Ok(true)
    }
    async fn credit_grant_balance_cents(&self, _: &MacroUserIdStr<'_>) -> Result<i64> {
        Ok(0)
    }
}

#[tokio::test]
async fn team_member_grant_lands_on_team_owner_once() {
    let owner = MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap();
    let member = MacroUserIdStr::try_from("macro|member@example.com".to_string()).unwrap();
    let team_id = Uuid::parse_str("01a15302-4b49-7df3-8b84-40b43624d747").unwrap();
    let service = CreditGrantService::new(
        OneEntitlement(Entitlement {
            tier: PlanTier::Premium,
            seat_tiers: vec![PlanTier::Premium, PlanTier::Premium],
            unlimited: false,
            payer: owner.clone(),
            billed_users: vec![owner.clone(), member.clone()],
            scope: PayerScope::TeamMember { team_id },
        }),
        RecordingRepo::default(),
    );
    let grant = CreditGrant {
        id: Uuid::parse_str("019a0f6e-0000-7000-8000-000000000001").unwrap(),
        amount_cents: NonZeroU32::new(1500).unwrap(),
        note: "refund".to_string(),
    };

    let (target, inserted) = service.grant(&member, &grant).await.unwrap();
    let (_, retried) = service.grant(&member, &grant).await.unwrap();

    assert_eq!(
        target,
        GrantTarget {
            payer: owner,
            tier: PlanTier::Premium,
        }
    );
    assert!(inserted);
    assert!(!retried);
    assert_eq!(
        *service.repo.booked.lock().unwrap(),
        vec![(
            "macro|owner@example.com".to_string(),
            Uuid::parse_str("019a0f6e-0000-7000-8000-000000000001").unwrap(),
            1500,
        )]
    );
}

#[tokio::test]
async fn free_user_grant_is_refused() {
    let user = MacroUserIdStr::try_from("macro|free@example.com".to_string()).unwrap();
    let service = CreditGrantService::new(
        OneEntitlement(Entitlement::personal(user.clone(), PlanTier::Free)),
        RecordingRepo::default(),
    );
    let grant = CreditGrant {
        id: Uuid::parse_str("019a0f6e-0000-7000-8000-000000000002").unwrap(),
        amount_cents: NonZeroU32::new(1500).unwrap(),
        note: "refund".to_string(),
    };

    let result = service.grant(&user, &grant).await;

    assert!(matches!(result, Err(BillingError::FreePlan)));
    assert!(service.repo.booked.lock().unwrap().is_empty());
}
