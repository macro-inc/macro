use super::*;
use ai_billing::domain::{Entitlement, PayerScope};
use macro_user_id::cowlike::CowLike;
use std::sync::Mutex;
use teams::domain::model::SeatPlan;

struct Entitlements {
    value: Entitlement,
    customer_for: Mutex<Vec<String>>,
}
impl EntitlementSource for Entitlements {
    async fn entitlement(&self, _: &MacroUserIdStr<'_>) -> ai_billing::domain::Result<Entitlement> {
        Ok(self.value.clone())
    }
    async fn stripe_customer_id(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> ai_billing::domain::Result<Option<String>> {
        self.customer_for.lock().unwrap().push(user.to_string());
        Ok(Some("cus_payer".into()))
    }
    async fn team_payer(
        &self,
        _: macro_uuid::Uuid,
    ) -> ai_billing::domain::Result<Option<MacroUserIdStr<'static>>> {
        unreachable!()
    }
}
struct Gateway {
    access: billing_facts::BillingAccess,
    billing_reads: Mutex<Vec<bool>>,
    facts: Option<SubscriptionPlanFacts>,
    calls: Mutex<Vec<(String, SubscriptionScope, String)>>,
}
impl SubscriptionStatusGateway for Gateway {
    async fn billing_access(
        &self,
        _: SubscriptionScope,
        _: &MacroUserIdStr<'_>,
    ) -> Result<billing_facts::BillingAccess, PlanChangeError> {
        Ok(self.access.clone())
    }

    async fn status(
        &self,
        customer: &str,
        scope: SubscriptionScope,
        user: &MacroUserIdStr<'_>,
        read_billing: bool,
    ) -> Result<Option<SubscriptionPlanFacts>, PlanChangeError> {
        self.billing_reads.lock().unwrap().push(read_billing);
        self.calls
            .lock()
            .unwrap()
            .push((customer.into(), scope, user.to_string()));
        Ok(self.facts.clone())
    }
}
fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|member@example.com")
        .unwrap()
        .into_owned()
}
fn date(value: &str) -> DateTime<Utc> {
    value.parse().unwrap()
}
fn service(
    value: Entitlement,
    change: Option<ScheduledSeatPlan>,
) -> SubscriptionStatusService<Entitlements, Gateway> {
    SubscriptionStatusService::new(
        Entitlements {
            value,
            customer_for: Mutex::new(Vec::new()),
        },
        Gateway {
            access: billing_facts::BillingAccess::Personal,
            billing_reads: Mutex::new(vec![]),
            facts: Some(SubscriptionPlanFacts {
                period_end: date("2026-11-01T12:00:00Z"),
                scheduled_change: change,
                billing: None,
            }),
            calls: Mutex::new(Vec::new()),
        },
    )
}
fn downgrade(at: &str) -> Option<ScheduledSeatPlan> {
    Some(ScheduledSeatPlan {
        plan: SeatPlan::Premium,
        effective_at: date(at),
    })
}

#[tokio::test]
async fn returns_pending_downgrade_from_the_authenticated_personal_scope() {
    let service = service(
        Entitlement::personal(user(), PlanTier::Max),
        downgrade("2026-11-01T12:00:00Z"),
    );
    let status = service.status(&user()).await.unwrap();
    assert_eq!(status.scheduled_change.unwrap().plan, SeatPlan::Premium);
    assert_eq!(status.renewal_date, Some(date("2026-11-01T12:00:00Z")));
    assert_eq!(
        *service.gateway.calls.lock().unwrap(),
        vec![(
            "cus_payer".into(),
            SubscriptionScope::Personal,
            user().to_string()
        )]
    );
}

#[tokio::test]
async fn team_member_reads_the_owners_customer_but_only_their_own_seat() {
    let owner = MacroUserIdStr::try_from("macro|owner@example.com")
        .unwrap()
        .into_owned();
    let team_id = macro_uuid::generate_uuid_v7();
    let mut entitlement = Entitlement::personal(user(), PlanTier::Max);
    entitlement.payer = owner.clone();
    entitlement.scope = PayerScope::TeamMember { team_id };
    let service = service(entitlement, downgrade("2026-11-01T12:00:00Z"));
    service.status(&user()).await.unwrap();
    assert_eq!(
        *service.entitlements.customer_for.lock().unwrap(),
        vec![owner.to_string()]
    );
    assert_eq!(
        *service.gateway.calls.lock().unwrap(),
        vec![(
            "cus_payer".into(),
            SubscriptionScope::Team { team_id },
            user().to_string()
        )]
    );
}

#[tokio::test]
async fn applied_or_already_effective_changes_are_hidden() {
    for (tier, at) in [
        (PlanTier::Max, "2026-10-01T12:00:00Z"),
        (PlanTier::Premium, "2026-11-01T12:00:00Z"),
    ] {
        let service = service(Entitlement::personal(user(), tier), downgrade(at));
        assert!(
            service
                .status(&user())
                .await
                .unwrap()
                .scheduled_change
                .is_none()
        );
    }
}

#[tokio::test]
async fn canceled_schedule_has_no_banner_but_keeps_the_renewal_date() {
    let service = service(Entitlement::personal(user(), PlanTier::Max), None);
    let status = service.status(&user()).await.unwrap();
    assert!(status.scheduled_change.is_none());
    assert!(status.renewal_date.is_some());
}

#[tokio::test]
async fn free_accounts_do_not_read_stripe() {
    for (tier, unlimited) in [(PlanTier::Free, false), (PlanTier::Free, true)] {
        let mut entitlement = Entitlement::personal(user(), tier);
        entitlement.unlimited = unlimited;
        let service = service(entitlement, None);
        assert!(
            service
                .status(&user())
                .await
                .unwrap()
                .renewal_date
                .is_none()
        );
        assert!(service.gateway.calls.lock().unwrap().is_empty());
        assert!(service.entitlements.customer_for.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn unlimited_ai_usage_does_not_hide_an_existing_paid_subscription() {
    let mut entitlement = Entitlement::personal(user(), PlanTier::Max);
    entitlement.unlimited = true;
    let service = service(entitlement, None);
    assert!(
        service
            .status(&user())
            .await
            .unwrap()
            .renewal_date
            .is_some()
    );
    assert_eq!(service.gateway.calls.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn ordinary_team_members_keep_renewal_without_requesting_financial_details() {
    let team_id = macro_uuid::generate_uuid_v7();
    let mut entitlement = Entitlement::personal(user(), PlanTier::Max);
    entitlement.scope = PayerScope::TeamMember { team_id };
    let mut service = service(entitlement, None);
    service.gateway.access =
        billing_facts::BillingAccess::Team(Some(teams::domain::model::TeamRole::Member));
    service.gateway.facts.as_mut().unwrap().billing =
        Some(billing_facts::SubscriptionBillingFacts {
            access: billing_facts::BillingAccess::Team(Some(teams::domain::model::TeamRole::Owner)),
            currency: "usd".to_owned(),
            interval: team_agents::domain::models::BillingInterval::Month,
            items: vec![],
            seats: vec![],
            computers: vec![],
            next_invoice: None,
        });
    let status = service.status(&user()).await.unwrap();
    assert!(status.renewal_date.is_some());
    assert!(status.billing.is_none());
    assert_eq!(*service.gateway.billing_reads.lock().unwrap(), vec![false]);
}
