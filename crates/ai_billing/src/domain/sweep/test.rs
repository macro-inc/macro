use super::*;
use crate::domain::models::{
    AllowanceDecision, AutoReloadThresholds, BillingError, Entitlement, PayerScope, PlanTier,
    UsageSnapshot,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use macro_uuid::Uuid;
use std::collections::HashMap;
use std::sync::Mutex;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

/// The `(since, now)` window one candidate query was asked for.
type Window = (DateTime<Utc>, DateTime<Utc>);

/// Returns the configured candidates and remembers the window it was asked for.
#[derive(Clone, Default)]
struct FakeCandidates {
    users: Vec<MacroUserIdStr<'static>>,
    fail: bool,
    windows: Arc<Mutex<Vec<Window>>>,
}

impl SettlementCandidates for FakeCandidates {
    async fn candidates(
        &self,
        since: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> Result<Vec<MacroUserIdStr<'static>>> {
        self.windows.lock().unwrap().push((since, now));
        if self.fail {
            return Err(BillingError::Storage(anyhow::anyhow!(
                "candidates unavailable"
            )));
        }
        Ok(self.users.clone())
    }
}

#[derive(Clone, Default)]
struct FakeEntitlements {
    by_user: HashMap<String, Entitlement>,
    fail_for: Option<String>,
}

impl EntitlementSource for FakeEntitlements {
    async fn entitlement(&self, user: &MacroUserIdStr<'_>) -> Result<Entitlement> {
        if self.fail_for.as_deref() == Some(user.as_ref()) {
            return Err(BillingError::Entitlement(anyhow::anyhow!(
                "roles unavailable"
            )));
        }
        Ok(self
            .by_user
            .get(user.as_ref())
            .cloned()
            .unwrap_or_else(|| Entitlement::personal(user.clone().into_owned(), PlanTier::Free)))
    }
    async fn stripe_customer_id(&self, _user: &MacroUserIdStr<'_>) -> Result<Option<String>> {
        unreachable!()
    }
    async fn team_payer(&self, _team_id: Uuid) -> Result<Option<MacroUserIdStr<'static>>> {
        unreachable!()
    }
}

/// Records who was settled and fails for one configured payer.
#[derive(Default)]
struct FakeBilling {
    settled: Mutex<Vec<String>>,
    fail_for: Option<String>,
}

impl BillingService for FakeBilling {
    async fn settle(&self, user: &MacroUserIdStr<'_>) -> Result<()> {
        self.settled.lock().unwrap().push(user.to_string());
        if self.fail_for.as_deref() == Some(user.as_ref()) {
            return Err(BillingError::NoStripeCustomer);
        }
        Ok(())
    }
    async fn snapshot(&self, _user: &MacroUserIdStr<'_>) -> Result<UsageSnapshot> {
        unreachable!()
    }
    async fn check_allowance(&self, _user: &MacroUserIdStr<'_>) -> Result<AllowanceDecision> {
        unreachable!()
    }
    async fn update_overage(
        &self,
        _user: &MacroUserIdStr<'_>,
        _enabled: bool,
        _limit_cents: i64,
    ) -> Result<UsageSnapshot> {
        unreachable!()
    }
    async fn update_auto_reload(
        &self,
        _user: &MacroUserIdStr<'_>,
        _enabled: bool,
        _thresholds: AutoReloadThresholds,
    ) -> Result<UsageSnapshot> {
        unreachable!()
    }
    async fn create_credit_checkout(
        &self,
        _user: &MacroUserIdStr<'_>,
        _amount_cents: i64,
        _success_url: String,
        _cancel_url: String,
    ) -> Result<String> {
        unreachable!()
    }
    async fn apply_credit_purchase(
        &self,
        _payer: &MacroUserIdStr<'_>,
        _amount_cents: i64,
        _stripe_reference: &str,
    ) -> Result<()> {
        unreachable!()
    }
    async fn sync_period(
        &self,
        _payer: &MacroUserIdStr<'_>,
        _start: DateTime<Utc>,
        _end: DateTime<Utc>,
        _verified: Option<crate::domain::period::SubscriptionPeriod>,
    ) -> Result<()> {
        unreachable!()
    }
    async fn mark_overage_invoice(&self, _stripe_invoice_id: &str, _paid: bool) -> Result<()> {
        unreachable!()
    }
    async fn mark_credit_reload_invoice(
        &self,
        _stripe_invoice_id: &str,
        _paid: bool,
    ) -> Result<()> {
        unreachable!()
    }
}

fn team_member(member: &MacroUserIdStr<'static>, owner: &MacroUserIdStr<'static>) -> Entitlement {
    let team_id = Uuid::nil();
    Entitlement {
        tier: PlanTier::Premium,
        seat_tiers: vec![PlanTier::Premium, PlanTier::Premium],
        unlimited: false,
        payer: owner.clone(),
        billed_users: vec![owner.clone(), member.clone()],
        scope: PayerScope::TeamMember { team_id },
    }
}

#[tokio::test]
async fn settles_each_metered_payer_once_over_the_lookback_window() {
    let owner = user("owner@x.com");
    let member_a = user("a@x.com");
    let member_b = user("b@x.com");
    let solo = user("solo@x.com");
    let free = user("free@x.com");
    let mut unlimited = Entitlement::personal(user("enterprise@x.com"), PlanTier::Max);
    unlimited.unlimited = true;
    let entitlements = FakeEntitlements {
        by_user: HashMap::from([
            (member_a.to_string(), team_member(&member_a, &owner)),
            (member_b.to_string(), team_member(&member_b, &owner)),
            (
                owner.to_string(),
                Entitlement {
                    scope: PayerScope::TeamOwner {
                        team_id: Uuid::nil(),
                    },
                    ..team_member(&member_a, &owner)
                },
            ),
            (
                solo.to_string(),
                Entitlement::personal(solo.clone(), PlanTier::Premium),
            ),
            (unlimited.payer.to_string(), unlimited.clone()),
        ]),
        fail_for: None,
    };
    let candidates = FakeCandidates {
        users: vec![
            member_a.clone(),
            solo.clone(),
            member_b.clone(),
            free.clone(),
            owner.clone(),
            unlimited.payer.clone(),
        ],
        ..FakeCandidates::default()
    };
    let billing = Arc::new(FakeBilling::default());
    let sweep = SettlementSweep::new(billing.clone(), candidates.clone(), entitlements);

    let now = Utc::now();
    let report = sweep.run_once(now).await.unwrap();

    assert_eq!(
        report,
        SweepReport {
            candidates: 6,
            payers: 2,
            failed: 0,
        }
    );
    // Three team candidates collapse onto their payer; free and unlimited
    // users are never metered and never reach the billing service.
    assert_eq!(
        *billing.settled.lock().unwrap(),
        vec![owner.to_string(), solo.to_string()]
    );
    assert_eq!(
        *candidates.windows.lock().unwrap(),
        vec![(now - RECONCILIATION_LOOKBACK, now)]
    );
}

#[tokio::test]
async fn a_failing_payer_is_counted_and_does_not_stop_the_sweep() {
    let broken_roles = user("broken@x.com");
    let declined = user("declined@x.com");
    let fine = user("fine@x.com");
    let entitlements = FakeEntitlements {
        by_user: HashMap::from([
            (
                declined.to_string(),
                Entitlement::personal(declined.clone(), PlanTier::Premium),
            ),
            (
                fine.to_string(),
                Entitlement::personal(fine.clone(), PlanTier::Premium),
            ),
        ]),
        fail_for: Some(broken_roles.to_string()),
    };
    let billing = Arc::new(FakeBilling {
        fail_for: Some(declined.to_string()),
        ..FakeBilling::default()
    });
    let sweep = SettlementSweep::new(
        billing.clone(),
        FakeCandidates {
            users: vec![broken_roles, declined.clone(), fine.clone()],
            ..FakeCandidates::default()
        },
        entitlements,
    );

    let report = sweep.run_once(Utc::now()).await.unwrap();

    assert_eq!(
        report,
        SweepReport {
            candidates: 3,
            payers: 2,
            failed: 2,
        }
    );
    assert_eq!(
        *billing.settled.lock().unwrap(),
        vec![declined.to_string(), fine.to_string()]
    );
}

#[tokio::test]
async fn an_unavailable_candidate_list_fails_the_sweep_before_settling_anyone() {
    let billing = Arc::new(FakeBilling::default());
    let sweep = SettlementSweep::new(
        billing.clone(),
        FakeCandidates {
            users: vec![user("someone@x.com")],
            fail: true,
            ..FakeCandidates::default()
        },
        FakeEntitlements::default(),
    );

    assert!(sweep.run_once(Utc::now()).await.is_err());
    assert!(billing.settled.lock().unwrap().is_empty());
}
