use super::*;
use crate::domain::ledger::plan_settlement;
use crate::domain::models::{DenyReason, PayerScope, PeriodLedger};
use crate::domain::ports::{OverageChargeReceipt, SettlementOutcome};
use macro_user_id::cowlike::CowLike;
use macro_uuid::Uuid;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

#[derive(Clone, Default)]
struct FakeEntitlements {
    by_user: Arc<Mutex<HashMap<String, Entitlement>>>,
    customers: Arc<Mutex<HashMap<String, String>>>,
}

impl FakeEntitlements {
    fn with(self, ent: Entitlement) -> Self {
        for u in &ent.billed_users {
            self.by_user
                .lock()
                .unwrap()
                .insert(u.to_string(), ent.clone());
        }
        self
    }
    fn with_customer(self, u: &MacroUserIdStr<'_>, customer: &str) -> Self {
        self.customers
            .lock()
            .unwrap()
            .insert(u.to_string(), customer.to_string());
        self
    }
}

impl EntitlementSource for FakeEntitlements {
    async fn entitlement(&self, user: &MacroUserIdStr<'_>) -> Result<Entitlement> {
        Ok(self
            .by_user
            .lock()
            .unwrap()
            .get(user.as_ref())
            .cloned()
            .unwrap_or_else(|| Entitlement::personal(user.clone().into_owned(), PlanTier::Free)))
    }
    async fn stripe_customer_id(&self, user: &MacroUserIdStr<'_>) -> Result<Option<String>> {
        Ok(self.customers.lock().unwrap().get(user.as_ref()).cloned())
    }
}

#[derive(Clone, Default)]
struct FakeUsage {
    cents: Arc<Mutex<i64>>,
}

impl UsageReader for FakeUsage {
    /// All fake usage happened "now": only the current period sees it.
    async fn list_rate_usage_cents(
        &self,
        _users: &[MacroUserIdStr<'static>],
        period: BillingPeriod,
    ) -> Result<i64> {
        let now = Utc::now();
        if period.start <= now && now < period.end {
            Ok(*self.cents.lock().unwrap())
        } else {
            Ok(0)
        }
    }
}

#[derive(Default)]
struct RepoState {
    settings: BillingSettings,
    balance: i64,
    ledgers: HashMap<DateTime<Utc>, PeriodLedger>,
    purchases: Vec<String>,
    charges: Vec<(Uuid, i64, OverageChargeStatus, Option<String>)>,
    suspended: bool,
}

#[derive(Clone, Default)]
struct FakeRepo {
    state: Arc<Mutex<RepoState>>,
}

impl BillingRepo for FakeRepo {
    async fn settings(&self, _payer: &MacroUserIdStr<'_>) -> Result<BillingSettings> {
        let s = self.state.lock().unwrap();
        let mut settings = s.settings.clone();
        settings.overage_suspended_at = s.suspended.then(Utc::now);
        Ok(settings)
    }
    async fn update_overage(
        &self,
        _payer: &MacroUserIdStr<'_>,
        enabled: bool,
        limit_cents: i64,
    ) -> Result<()> {
        let mut s = self.state.lock().unwrap();
        s.settings.overage_enabled = enabled;
        s.settings.overage_limit_cents = limit_cents;
        s.suspended = false;
        Ok(())
    }
    async fn set_period(
        &self,
        _payer: &MacroUserIdStr<'_>,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<()> {
        self.state.lock().unwrap().settings.period_anchor = Some((start, end));
        Ok(())
    }
    async fn suspend_overage(&self, _payer: &MacroUserIdStr<'_>) -> Result<()> {
        self.state.lock().unwrap().suspended = true;
        Ok(())
    }
    async fn clear_overage_suspension(&self, _payer: &MacroUserIdStr<'_>) -> Result<()> {
        self.state.lock().unwrap().suspended = false;
        Ok(())
    }
    async fn credit_balance_cents(&self, _payer: &MacroUserIdStr<'_>) -> Result<i64> {
        Ok(self.state.lock().unwrap().balance)
    }
    async fn period_ledger(
        &self,
        _payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
    ) -> Result<PeriodLedger> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .ledgers
            .get(&period_start)
            .copied()
            .unwrap_or_default())
    }
    async fn record_credit_purchase(
        &self,
        _payer: &MacroUserIdStr<'_>,
        amount_cents: i64,
        stripe_reference: &str,
    ) -> Result<bool> {
        let mut s = self.state.lock().unwrap();
        if s.purchases.iter().any(|r| r == stripe_reference) {
            return Ok(false);
        }
        s.purchases.push(stripe_reference.to_string());
        s.balance += amount_cents;
        Ok(true)
    }
    async fn apply_settlement(
        &self,
        _payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
        used_cents: i64,
        included_cents: i64,
        policy: SettlementPolicy,
    ) -> Result<SettlementOutcome> {
        let mut s = self.state.lock().unwrap();
        let balance = s.balance;
        let overage_active =
            s.settings.overage_enabled && !s.suspended && s.settings.overage_limit_cents > 0;
        let overage_limit_cents = s.settings.overage_limit_cents;
        let ledger = s.ledgers.entry(period_start).or_default();
        let plan = plan_settlement(
            crate::domain::ledger::SettlementState {
                used_cents,
                included_cents,
                credits_consumed_cents: ledger.credits_consumed_cents,
                overage_charged_cents: ledger.overage_charged_cents,
                credit_balance_cents: balance,
            },
            SettlementPolicy {
                overage_active,
                overage_limit_cents,
                ..policy
            },
        );
        ledger.credits_consumed_cents += plan.consume_credits_cents;
        ledger.overage_charged_cents += plan.charge_overage_cents;
        s.balance -= plan.consume_credits_cents;
        let pending_charge = (plan.charge_overage_cents > 0).then(|| {
            let id = macro_uuid::generate_uuid_v7();
            s.charges.push((
                id,
                plan.charge_overage_cents,
                OverageChargeStatus::Pending,
                None,
            ));
            PendingCharge {
                id,
                amount_cents: plan.charge_overage_cents,
            }
        });
        Ok(SettlementOutcome {
            consumed_credits_cents: plan.consume_credits_cents,
            pending_charge,
        })
    }
    async fn finish_overage_charge(
        &self,
        charge_id: Uuid,
        stripe_invoice_id: Option<&str>,
        status: OverageChargeStatus,
    ) -> Result<()> {
        let mut s = self.state.lock().unwrap();
        let mut failed_amount = 0;
        for (id, amount, st, inv) in s.charges.iter_mut() {
            if *id == charge_id {
                *st = status;
                *inv = stripe_invoice_id.map(str::to_string);
                if status == OverageChargeStatus::Failed {
                    failed_amount += *amount;
                }
            }
        }
        // Failed charges stop covering usage.
        for ledger in s.ledgers.values_mut() {
            ledger.overage_charged_cents -= failed_amount;
        }
        Ok(())
    }
    async fn resolve_overage_invoice(
        &self,
        stripe_invoice_id: &str,
        status: OverageChargeStatus,
    ) -> Result<Option<MacroUserIdStr<'static>>> {
        let mut s = self.state.lock().unwrap();
        let found = s
            .charges
            .iter_mut()
            .find(|(_, _, _, inv)| inv.as_deref() == Some(stripe_invoice_id));
        Ok(found.map(|(_, _, st, _)| {
            *st = status;
            user("payer@x.com")
        }))
    }
}

#[derive(Clone, Default)]
struct FakePayments {
    fail: Arc<Mutex<bool>>,
    checkouts: Arc<Mutex<Vec<CreditCheckoutRequest>>>,
    charges: Arc<Mutex<Vec<OverageChargeRequest>>>,
}

impl PaymentGateway for FakePayments {
    async fn create_credit_checkout(&self, request: CreditCheckoutRequest) -> Result<String> {
        self.checkouts.lock().unwrap().push(request);
        Ok("https://checkout.stripe.test/session".to_string())
    }
    async fn charge_overage(&self, request: OverageChargeRequest) -> Result<OverageChargeReceipt> {
        self.charges.lock().unwrap().push(request.clone());
        if *self.fail.lock().unwrap() {
            return Err(BillingError::Payment(anyhow::anyhow!("card declined")));
        }
        Ok(OverageChargeReceipt {
            invoice_id: format!("in_{}", request.charge_id),
            paid: true,
        })
    }
}

type Service = BillingServiceImpl<FakeEntitlements, FakeUsage, FakeRepo, FakePayments>;

fn premium_service(used_cents: i64) -> (Service, FakeRepo, FakePayments, FakeUsage) {
    let payer = user("payer@x.com");
    let ents = FakeEntitlements::default()
        .with(Entitlement::personal(payer.clone(), PlanTier::Premium))
        .with_customer(&payer, "cus_123");
    let usage = FakeUsage {
        cents: Arc::new(Mutex::new(used_cents)),
    };
    let repo = FakeRepo::default();
    let payments = FakePayments::default();
    (
        BillingServiceImpl::new(ents, usage.clone(), repo.clone(), payments.clone()),
        repo,
        payments,
        usage,
    )
}

#[tokio::test]
async fn allows_within_allowance_and_denies_past_it() {
    let (svc, _, _, usage) = premium_service(3_000);
    let payer = user("payer@x.com");
    assert_eq!(
        svc.check_allowance(&payer).await.unwrap(),
        AllowanceDecision::Allow
    );
    *usage.cents.lock().unwrap() = 4_000;
    assert_eq!(
        svc.check_allowance(&payer).await.unwrap(),
        AllowanceDecision::Deny(DenyReason::AllowanceExhausted)
    );
}

#[tokio::test]
async fn free_users_are_not_gated() {
    let (svc, ..) = premium_service(1_000_000);
    let free = user("free@x.com");
    assert_eq!(
        svc.check_allowance(&free).await.unwrap(),
        AllowanceDecision::Allow
    );
    let snap = svc.snapshot(&free).await.unwrap();
    assert_eq!(snap.tier, PlanTier::Free);
    assert_eq!(snap.used_cents, 0);
}

#[tokio::test]
async fn credits_unblock_and_settlement_consumes_them() {
    let (svc, repo, ..) = premium_service(4_600);
    let payer = user("payer@x.com");
    assert!(matches!(
        svc.check_allowance(&payer).await.unwrap(),
        AllowanceDecision::Deny(_)
    ));

    svc.apply_credit_purchase(&payer, 2_500, "cs_1")
        .await
        .unwrap();
    // The purchase settles: 600 consumed, 1_900 left.
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.credits_consumed_cents, 600);
    assert_eq!(snap.credit_balance_cents, 1_900);
    assert_eq!(snap.uncovered_cents, 0);
    assert_eq!(snap.remaining_cents, 1_900);
    assert_eq!(
        svc.check_allowance(&payer).await.unwrap(),
        AllowanceDecision::Allow
    );

    // A webhook retry books nothing twice.
    svc.apply_credit_purchase(&payer, 2_500, "cs_1")
        .await
        .unwrap();
    assert_eq!(repo.state.lock().unwrap().balance, 1_900);
}

#[tokio::test]
async fn overage_is_charged_in_chunks_and_respects_the_cap() {
    let (svc, repo, payments, usage) = premium_service(4_500);
    let payer = user("payer@x.com");

    let snap = svc.update_overage(&payer, true, 2_000).await.unwrap();
    assert!(snap.overage_enabled);
    // 500 over: under the $10 chunk, nothing charged yet but plenty of room.
    assert_eq!(snap.overage_charged_cents, 0);
    assert_eq!(snap.remaining_cents, 1_500);

    *usage.cents.lock().unwrap() = 5_200;
    svc.settle(&payer).await.unwrap();
    let charges = payments.charges.lock().unwrap().clone();
    assert_eq!(charges.len(), 1);
    assert_eq!(charges[0].amount_cents, 1_200);
    assert_eq!(charges[0].customer_id, "cus_123");
    assert_eq!(
        repo.state.lock().unwrap().charges[0].2,
        OverageChargeStatus::Paid
    );

    // Past the cap: the last 800 of room is under the charge chunk, so it
    // waits for period end, and the payer is blocked with the right reason.
    *usage.cents.lock().unwrap() = 7_000;
    svc.settle(&payer).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.overage_charged_cents, 1_200);
    assert_eq!(snap.remaining_cents, 0);
    assert_eq!(snap.blocked_reason, Some(DenyReason::OverageLimitReached));
}

#[tokio::test]
async fn failed_overage_charge_suspends_overage() {
    let (svc, repo, payments, _) = premium_service(5_500);
    let payer = user("payer@x.com");
    *payments.fail.lock().unwrap() = true;

    // Enabling settles; the collection failure is swallowed into the snapshot.
    let snap = svc.update_overage(&payer, true, 5_000).await.unwrap();
    assert!(snap.overage_suspended);
    assert_eq!(snap.blocked_reason, Some(DenyReason::OveragePaymentFailed));
    assert_eq!(
        repo.state.lock().unwrap().charges[0].2,
        OverageChargeStatus::Failed
    );
    assert_eq!(
        svc.check_allowance(&payer).await.unwrap(),
        AllowanceDecision::Deny(DenyReason::OveragePaymentFailed)
    );

    // Fixing the card and re-enabling retries and clears the suspension.
    *payments.fail.lock().unwrap() = false;
    let snap = svc.update_overage(&payer, true, 5_000).await.unwrap();
    assert!(!snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 1_500);
}

#[tokio::test]
async fn only_the_payer_manages_billing_and_needs_a_paid_plan() {
    let owner = user("owner@x.com");
    let member = user("member@x.com");
    let team = Entitlement {
        tier: PlanTier::Premium,
        unlimited: false,
        payer: owner.clone(),
        billed_users: vec![owner.clone(), member.clone()],
        scope: PayerScope::TeamOwner {
            team_id: macro_uuid::generate_uuid_v7(),
        },
    };
    let ents = FakeEntitlements::default()
        .with(team)
        .with_customer(&owner, "cus_owner");
    let svc = BillingServiceImpl::new(
        ents,
        FakeUsage::default(),
        FakeRepo::default(),
        FakePayments::default(),
    );

    assert!(matches!(
        svc.update_overage(&member, true, 1_000).await,
        Err(BillingError::NotPayer)
    ));
    assert!(matches!(
        svc.create_credit_checkout(&member, 1_000, "s".into(), "c".into())
            .await,
        Err(BillingError::NotPayer)
    ));
    assert!(matches!(
        svc.create_credit_checkout(&owner, 1_234, "s".into(), "c".into())
            .await,
        Err(BillingError::InvalidCreditAmount)
    ));
    assert!(matches!(
        svc.update_overage(&owner, true, 100).await,
        Err(BillingError::InvalidOverageLimit)
    ));
    let url = svc
        .create_credit_checkout(&owner, 2_500, "s".into(), "c".into())
        .await
        .unwrap();
    assert!(url.starts_with("https://checkout.stripe.test"));

    let free = user("free@x.com");
    assert!(matches!(
        svc.create_credit_checkout(&free, 1_000, "s".into(), "c".into())
            .await,
        Err(BillingError::FreePlan)
    ));

    // A member's snapshot shows the pooled position but no controls.
    let snap = svc.snapshot(&member).await.unwrap();
    assert!(!snap.can_manage_billing);
    assert_eq!(snap.seats, 2);
    assert_eq!(snap.included_cents, 8_000);
}

#[tokio::test]
async fn overage_invoice_webhooks_update_suspension() {
    let (svc, repo, _, usage) = premium_service(5_500);
    let payer = user("payer@x.com");
    svc.update_overage(&payer, true, 5_000).await.unwrap();
    let invoice = repo.state.lock().unwrap().charges[0].3.clone().unwrap();

    svc.mark_overage_invoice(&invoice, false).await.unwrap();
    assert!(svc.snapshot(&payer).await.unwrap().overage_suspended);

    svc.mark_overage_invoice(&invoice, true).await.unwrap();
    assert!(!svc.snapshot(&payer).await.unwrap().overage_suspended);

    // Unknown invoices are ignored.
    svc.mark_overage_invoice("in_unknown", false).await.unwrap();
    assert!(!svc.snapshot(&payer).await.unwrap().overage_suspended);
    drop(usage);
}

#[tokio::test]
async fn synced_period_anchors_the_snapshot() {
    let (svc, ..) = premium_service(0);
    let payer = user("payer@x.com");
    let start = Utc::now() - chrono::Duration::days(3);
    let end = start + chrono::Duration::days(30);
    svc.sync_period(&payer, start, end).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.period_start, start);
    assert_eq!(snap.period_end, end);
    // Inverted periods are ignored.
    svc.sync_period(&payer, end, start).await.unwrap();
    assert_eq!(svc.snapshot(&payer).await.unwrap().period_start, start);
}
