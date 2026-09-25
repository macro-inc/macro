use super::*;
use crate::domain::ledger::plan_settlement;
use crate::domain::models::{
    AllowanceStore, DenyReason, OpenPeriodStart, PayerScope, PeriodAllowance, PeriodLedger,
    PlanTier, SeatGeneration,
};
use crate::domain::ports::SettlementOutcome;
use macro_user_id::cowlike::CowLike;
use macro_uuid::Uuid;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use teams::domain::open_seat_release::OpenSeatRelease;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

#[derive(Clone, Default)]
struct FakeEntitlements {
    by_user: Arc<Mutex<HashMap<String, Entitlement>>>,
    customers: Arc<Mutex<HashMap<String, String>>>,
    payers: Arc<Mutex<HashMap<Uuid, MacroUserIdStr<'static>>>>,
}

impl FakeEntitlements {
    fn with(self, ent: Entitlement) -> Self {
        self.set(ent);
        self
    }
    fn set(&self, ent: Entitlement) {
        let mut by_user = self.by_user.lock().unwrap();
        for (index, user) in ent.billed_users.iter().enumerate() {
            let mut resolved = ent.clone();
            resolved.tier = ent.seat_tiers.get(index).copied().unwrap_or(ent.tier);
            resolved.scope = match &ent.scope {
                PayerScope::TeamOwner { team_id } | PayerScope::TeamMember { team_id } => {
                    if user.as_ref() == ent.payer.as_ref() {
                        PayerScope::TeamOwner { team_id: *team_id }
                    } else {
                        PayerScope::TeamMember { team_id: *team_id }
                    }
                }
                PayerScope::Personal => PayerScope::Personal,
            };
            by_user.insert(user.to_string(), resolved);
        }
    }
    fn with_customer(self, u: &MacroUserIdStr<'_>, customer: &str) -> Self {
        self.customers
            .lock()
            .unwrap()
            .insert(u.to_string(), customer.to_string());
        self
    }
    fn payer_for_team(self, team_id: Uuid, payer: MacroUserIdStr<'static>) -> Self {
        self.payers.lock().unwrap().insert(team_id, payer);
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
    async fn team_payer(&self, team_id: Uuid) -> Result<Option<MacroUserIdStr<'static>>> {
        Ok(self.payers.lock().unwrap().get(&team_id).cloned())
    }
}

#[derive(Clone, Default)]
struct FakeUsage {
    cents: Arc<Mutex<i64>>,
    /// Usage at a specific instant, attributed to one user.
    entries: Arc<Mutex<Vec<UsageEntry>>>,
}

struct UsageEntry {
    user: String,
    at: DateTime<Utc>,
    cents: i64,
}

impl FakeUsage {
    fn add(&self, user: &MacroUserIdStr<'_>, at: DateTime<Utc>, cents: i64) {
        self.entries.lock().unwrap().push(UsageEntry {
            user: user.to_string(),
            at,
            cents,
        });
    }
}

impl UsageReader for FakeUsage {
    /// `cents` is treated as current usage for the first requested user.
    /// `entries` are summed when their timestamp falls in the requested period.
    async fn list_rate_usage_cents_by_user(
        &self,
        users: &[MacroUserIdStr<'static>],
        period: BillingPeriod,
    ) -> Result<Vec<SeatUsage>> {
        let now = Utc::now();
        let mut totals: HashMap<String, i64> =
            users.iter().map(|user| (user.to_string(), 0)).collect();
        if period.start <= now
            && now < period.end
            && let Some(user) = users.first()
        {
            *totals.entry(user.to_string()).or_default() += *self.cents.lock().unwrap();
        }
        for entry in self.entries.lock().unwrap().iter() {
            if totals.contains_key(&entry.user) && period.start <= entry.at && entry.at < period.end
            {
                *totals.entry(entry.user.clone()).or_default() += entry.cents;
            }
        }
        totals
            .into_iter()
            .map(|(user, used_cents)| {
                Ok(SeatUsage {
                    user: MacroUserIdStr::try_from(user)
                        .map_err(|error| BillingError::Storage(error.into()))?,
                    used_cents,
                })
            })
            .collect()
    }
}

/// One `ai_overage_charge` row.
#[derive(Debug, Clone)]
struct FakeCharge {
    id: Uuid,
    period_start: DateTime<Utc>,
    amount_cents: i64,
    status: OverageChargeStatus,
    invoice: Option<String>,
}

#[derive(Default)]
struct RepoState {
    settings: BillingSettings,
    balance: i64,
    /// Credits consumed per period; charges are summed from `charges`.
    consumed: HashMap<DateTime<Utc>, i64>,
    purchases: Vec<String>,
    charges: Vec<FakeCharge>,
    suspended: bool,
    allowances: HashMap<DateTime<Utc>, PeriodAllowance>,
    releases: Vec<(String, DateTime<Utc>, String)>,
}

impl RepoState {
    fn ledger(&self, period_start: DateTime<Utc>) -> PeriodLedger {
        PeriodLedger {
            credits_consumed_cents: self.consumed.get(&period_start).copied().unwrap_or(0),
            // An invoiced charge can still collect even after a failure.
            overage_charged_cents: self
                .charges
                .iter()
                .filter(|c| {
                    c.period_start == period_start
                        && (c.status != OverageChargeStatus::Failed || c.invoice.is_some())
                })
                .map(|c| c.amount_cents)
                .sum(),
        }
    }
}

#[derive(Clone, Default)]
struct FakeRepo {
    state: Arc<Mutex<RepoState>>,
}

impl FakeRepo {
    fn charges(&self) -> Vec<FakeCharge> {
        self.state.lock().unwrap().charges.clone()
    }
    fn freeze(&self, period_start: DateTime<Utc>, allowance: PeriodAllowance) {
        self.state
            .lock()
            .unwrap()
            .allowances
            .insert(period_start, allowance);
    }
    fn allowance(&self, period_start: DateTime<Utc>) -> Option<PeriodAllowance> {
        self.state
            .lock()
            .unwrap()
            .allowances
            .get(&period_start)
            .cloned()
    }
    fn releases(&self) -> Vec<(String, DateTime<Utc>, String)> {
        self.state.lock().unwrap().releases.clone()
    }
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
        Ok(self.state.lock().unwrap().ledger(period_start))
    }
    async fn period_allowance(
        &self,
        _payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
    ) -> Result<Option<PeriodAllowance>> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .allowances
            .get(&period_start)
            .cloned())
    }
    async fn store_open_allowance(
        &self,
        _payer: &MacroUserIdStr<'_>,
        period: OpenPeriodStart,
        seats: &[SeatAllowance],
        observed: SeatGeneration,
    ) -> Result<AllowanceStore> {
        let mut state = self.state.lock().unwrap();
        if state.settings.seat_generation != observed {
            return Ok(AllowanceStore::Conflict);
        }
        state.allowances.insert(
            period.start(),
            PeriodAllowance {
                seats: seats.to_vec(),
            },
        );
        Ok(AllowanceStore::Stored)
    }
    async fn release_open_seat(
        &self,
        payer: &MacroUserIdStr<'_>,
        period: OpenPeriodStart,
        member: &MacroUserIdStr<'_>,
    ) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        let next = state.settings.seat_generation.raw().saturating_add(1);
        state.settings.seat_generation = SeatGeneration::from_raw(next);
        if let Some(allowance) = state.allowances.get_mut(&period.start()) {
            allowance
                .seats
                .retain(|seat| seat.user.as_ref() != member.as_ref());
        }
        state.releases.push((
            payer.as_ref().to_string(),
            period.start(),
            member.as_ref().to_string(),
        ));
        Ok(())
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
    /// Mirrors the Postgres adapter: credits first, then hand back a charge
    /// still owed. A failed invoiced charge remains coverage and is always
    /// retried once overage is active; an uninvoiced one must still fit the
    /// new charge plan.
    async fn apply_settlement(
        &self,
        _payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
        chargeable_cents: i64,
        policy: SettlementPolicy,
    ) -> Result<SettlementOutcome> {
        let mut s = self.state.lock().unwrap();
        let ledger = s.ledger(period_start);
        let overage_active =
            s.settings.overage_enabled && !s.suspended && s.settings.overage_limit_cents > 0;
        let plan = plan_settlement(
            crate::domain::ledger::SettlementState {
                chargeable_cents,
                credits_consumed_cents: ledger.credits_consumed_cents,
                overage_charged_cents: ledger.overage_charged_cents,
                credit_balance_cents: s.balance,
            },
            SettlementPolicy {
                overage_active,
                overage_limit_cents: s.settings.overage_limit_cents,
                ..policy
            },
        );
        *s.consumed.entry(period_start).or_default() += plan.consume_credits_cents;
        s.balance -= plan.consume_credits_cents;

        let owed = s.charges.iter().position(|c| {
            c.period_start == period_start
                && ((c.status == OverageChargeStatus::Pending && c.invoice.is_none())
                    || (c.status == OverageChargeStatus::Failed
                        && overage_active
                        && (c.invoice.is_some() || c.amount_cents <= plan.charge_overage_cents)))
        });
        let pending_charge = if let Some(i) = owed {
            s.charges[i].status = OverageChargeStatus::Pending;
            let c = &s.charges[i];
            Some(PendingCharge {
                id: c.id,
                amount_cents: c.amount_cents,
                stripe_invoice_id: c.invoice.clone(),
            })
        } else if plan.charge_overage_cents > 0 {
            let id = macro_uuid::generate_uuid_v7();
            s.charges.push(FakeCharge {
                id,
                period_start,
                amount_cents: plan.charge_overage_cents,
                status: OverageChargeStatus::Pending,
                invoice: None,
            });
            Some(PendingCharge {
                id,
                amount_cents: plan.charge_overage_cents,
                stripe_invoice_id: None,
            })
        } else {
            None
        };
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
        for c in s.charges.iter_mut().filter(|c| c.id == charge_id) {
            c.status = status;
            if let Some(inv) = stripe_invoice_id {
                c.invoice = Some(inv.to_string());
            }
        }
        Ok(())
    }
    async fn resolve_overage_invoice(
        &self,
        stripe_invoice_id: &str,
        status: OverageChargeStatus,
    ) -> Result<Option<MacroUserIdStr<'static>>> {
        let mut s = self.state.lock().unwrap();
        let found = s.charges.iter_mut().find(|c| {
            c.invoice.as_deref() == Some(stripe_invoice_id)
                && c.status != OverageChargeStatus::Paid
                && c.status != status
        });
        Ok(found.map(|c| {
            c.status = status;
            user("payer@x.com")
        }))
    }
    async fn latest_charge_status(
        &self,
        _payer: &MacroUserIdStr<'_>,
    ) -> Result<Option<OverageChargeStatus>> {
        Ok(self.state.lock().unwrap().charges.last().map(|c| c.status))
    }
}

/// How the fake provider answers the next payment attempts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum PayOutcome {
    #[default]
    Paid,
    /// Card declined: the invoice stays open for Stripe's retries.
    Declined,
    /// The provider could not be reached.
    Error,
}

#[derive(Clone, Default)]
struct FakePayments {
    fail_open: Arc<Mutex<bool>>,
    pay_outcome: Arc<Mutex<PayOutcome>>,
    checkouts: Arc<Mutex<Vec<CreditCheckoutRequest>>>,
    opened: Arc<Mutex<Vec<OverageChargeRequest>>>,
    payments: Arc<Mutex<Vec<(Uuid, String)>>>,
}

impl FakePayments {
    fn set_pay(&self, outcome: PayOutcome) {
        *self.pay_outcome.lock().unwrap() = outcome;
    }
    fn opened(&self) -> Vec<OverageChargeRequest> {
        self.opened.lock().unwrap().clone()
    }
    fn payments(&self) -> Vec<(Uuid, String)> {
        self.payments.lock().unwrap().clone()
    }
}

impl PaymentGateway for FakePayments {
    async fn create_credit_checkout(&self, request: CreditCheckoutRequest) -> Result<String> {
        self.checkouts.lock().unwrap().push(request);
        Ok("https://checkout.stripe.test/session".to_string())
    }
    async fn open_overage_invoice(&self, request: OverageChargeRequest) -> Result<String> {
        if *self.fail_open.lock().unwrap() {
            return Err(BillingError::Payment(anyhow::anyhow!("stripe unavailable")));
        }
        let invoice = format!("in_{}", request.charge_id);
        self.opened.lock().unwrap().push(request);
        Ok(invoice)
    }
    async fn pay_overage_invoice(&self, charge_id: Uuid, invoice_id: &str) -> Result<bool> {
        self.payments
            .lock()
            .unwrap()
            .push((charge_id, invoice_id.to_string()));
        match *self.pay_outcome.lock().unwrap() {
            PayOutcome::Paid => Ok(true),
            PayOutcome::Declined => Ok(false),
            PayOutcome::Error => Err(BillingError::Payment(anyhow::anyhow!("card declined"))),
        }
    }
}

type Service = BillingServiceImpl<FakeEntitlements, FakeUsage, FakeRepo, FakePayments>;

fn premium_service(used_cents: i64) -> (Service, FakeRepo, FakePayments, FakeUsage) {
    premium_service_in(Environment::Develop, used_cents)
}

fn premium_service_in(
    environment: Environment,
    used_cents: i64,
) -> (Service, FakeRepo, FakePayments, FakeUsage) {
    let payer = user("payer@x.com");
    let ents = FakeEntitlements::default()
        .with(Entitlement::personal(payer.clone(), PlanTier::Premium))
        .with_customer(&payer, "cus_123");
    let usage = FakeUsage {
        cents: Arc::new(Mutex::new(used_cents)),
        entries: Default::default(),
    };
    let repo = FakeRepo::default();
    let payments = FakePayments::default();
    (
        BillingServiceImpl::new(
            ents,
            usage.clone(),
            repo.clone(),
            payments.clone(),
            environment,
        ),
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
    assert_eq!(
        svc.snapshot(&payer).await.unwrap().blocked_reason,
        Some(DenyReason::AllowanceExhausted)
    );
}

#[tokio::test]
async fn outside_dev_allows_exhausted_allowances_caps_and_failed_payments() {
    for environment in [Environment::Production, Environment::Local] {
        let (svc, repo, _, _) = premium_service_in(environment, 1_000_000);
        let payer = user("payer@x.com");
        assert_eq!(
            svc.check_allowance(&payer).await.unwrap(),
            AllowanceDecision::Allow
        );
        assert_eq!(svc.snapshot(&payer).await.unwrap().blocked_reason, None);

        let snapshot = svc.update_overage(&payer, true, 1_000).await.unwrap();
        assert_eq!(snapshot.blocked_reason, None);
        assert_eq!(
            svc.check_allowance(&payer).await.unwrap(),
            AllowanceDecision::Allow
        );

        repo.state.lock().unwrap().suspended = true;
        assert_eq!(
            svc.check_allowance(&payer).await.unwrap(),
            AllowanceDecision::Allow
        );
        assert_eq!(svc.snapshot(&payer).await.unwrap().blocked_reason, None);
    }
}

#[tokio::test]
async fn outside_dev_preserves_credits_and_never_reserves_or_collects_overage() {
    for environment in [Environment::Production, Environment::Local] {
        let (mut svc, repo, payments, usage, _, payer, previous, current) =
            anchored_premium(1_000_000);
        svc.environment = environment;
        svc.sync_period(&payer, current.start, current.end)
            .await
            .unwrap();
        usage.add(
            &payer,
            previous.start + chrono::Duration::days(2),
            1_000_000,
        );

        svc.update_overage(&payer, true, 10_000).await.unwrap();
        svc.apply_credit_purchase(&payer, 2_500, "cs_paused")
            .await
            .unwrap();
        svc.apply_credit_purchase(&payer, 2_500, "cs_paused")
            .await
            .unwrap();
        svc.settle(&payer).await.unwrap();
        svc.settle(&payer).await.unwrap();

        let snapshot = svc.snapshot(&payer).await.unwrap();
        assert_eq!(snapshot.used_cents, 1_000_000);
        assert_eq!(snapshot.credit_balance_cents, 2_500);
        assert_eq!(snapshot.credits_consumed_cents, 0);
        assert_eq!(snapshot.overage_charged_cents, 0);
        assert!(repo.state.lock().unwrap().consumed.is_empty());
        assert!(repo.charges().is_empty());
        assert!(payments.opened().is_empty());
        assert!(payments.payments().is_empty());
    }
}

#[tokio::test]
async fn outside_dev_does_not_retry_pending_or_failed_charges() {
    for environment in [Environment::Production, Environment::Local] {
        for status in [OverageChargeStatus::Pending, OverageChargeStatus::Failed] {
            for invoice in [None, Some("in_existing".to_string())] {
                let (svc, repo, payments, _) = premium_service_in(environment, 1_000_000);
                let payer = user("payer@x.com");
                let period = BillingPeriod::current(None, Utc::now());
                repo.state.lock().unwrap().charges.push(FakeCharge {
                    id: macro_uuid::generate_uuid_v7(),
                    period_start: period.start,
                    amount_cents: 1_000,
                    status,
                    invoice: invoice.clone(),
                });

                svc.update_overage(&payer, true, 10_000).await.unwrap();
                svc.settle(&payer).await.unwrap();

                let charges = repo.charges();
                assert_eq!(charges.len(), 1);
                assert_eq!(charges[0].status, status);
                assert_eq!(charges[0].invoice, invoice);
                assert!(payments.opened().is_empty());
                assert!(payments.payments().is_empty());
            }
        }
    }
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
    let opened = payments.opened();
    assert_eq!(opened.len(), 1);
    assert_eq!(opened[0].amount_cents, 1_200);
    assert_eq!(opened[0].customer_id, "cus_123");
    let charges = repo.charges();
    let charge = &charges[0];
    assert_eq!(charge.status, OverageChargeStatus::Paid);
    assert_eq!(
        charge.invoice.as_deref(),
        Some(format!("in_{}", charge.id).as_str())
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
async fn failed_overage_charge_suspends_overage_and_is_retried_not_duplicated() {
    let (svc, repo, payments, _) = premium_service(5_500);
    let payer = user("payer@x.com");
    payments.set_pay(PayOutcome::Error);

    // Enabling settles; the collection failure is swallowed into the snapshot.
    let snap = svc.update_overage(&payer, true, 5_000).await.unwrap();
    assert!(snap.overage_suspended);
    assert_eq!(snap.blocked_reason, Some(DenyReason::OveragePaymentFailed));
    let charges = repo.charges();
    assert_eq!(charges.len(), 1);
    assert_eq!(charges[0].status, OverageChargeStatus::Failed);
    // The invoice was recorded before the payment attempt.
    let invoice = charges[0].invoice.clone().expect("invoice recorded");
    assert_eq!(
        svc.check_allowance(&payer).await.unwrap(),
        AllowanceDecision::Deny(DenyReason::OveragePaymentFailed)
    );

    // Fixing the card and re-enabling retries the same charge: the existing
    // invoice is paid, no second invoice is opened, no second row reserved.
    payments.set_pay(PayOutcome::Paid);
    let snap = svc.update_overage(&payer, true, 5_000).await.unwrap();
    assert!(!snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 1_500);
    let charges = repo.charges();
    assert_eq!(charges.len(), 1);
    assert_eq!(charges[0].status, OverageChargeStatus::Paid);
    assert_eq!(payments.opened().len(), 1);
    let paid = payments.payments();
    assert_eq!(paid.len(), 2);
    assert!(
        paid.iter()
            .all(|(id, inv)| *id == charges[0].id && *inv == invoice)
    );
}

#[tokio::test]
async fn opening_the_invoice_failing_marks_the_charge_failed() {
    let (svc, repo, payments, _) = premium_service(5_500);
    let payer = user("payer@x.com");
    *payments.fail_open.lock().unwrap() = true;

    let snap = svc.update_overage(&payer, true, 5_000).await.unwrap();
    assert!(snap.overage_suspended);
    let charges = repo.charges();
    assert_eq!(charges.len(), 1);
    assert_eq!(charges[0].status, OverageChargeStatus::Failed);
    assert!(charges[0].invoice.is_none());
    assert!(payments.payments().is_empty());

    // Once Stripe is back the retry opens the invoice for the same charge.
    *payments.fail_open.lock().unwrap() = false;
    svc.update_overage(&payer, true, 5_000).await.unwrap();
    let charges = repo.charges();
    assert_eq!(charges.len(), 1);
    assert_eq!(charges[0].status, OverageChargeStatus::Paid);
    assert_eq!(payments.opened()[0].charge_id, charges[0].id);
}

#[tokio::test]
async fn a_failed_uninvoiced_charge_whose_usage_credits_covered_is_not_retried() {
    let (svc, repo, payments, _) = premium_service(5_800);
    let payer = user("payer@x.com");
    *payments.fail_open.lock().unwrap() = true;
    svc.update_overage(&payer, true, 10_000).await.unwrap();
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Failed);
    assert!(repo.charges()[0].invoice.is_none());

    // Credits arrive and cover the 1_800 that was never invoiced.
    *payments.fail_open.lock().unwrap() = false;
    svc.apply_credit_purchase(&payer, 2_500, "cs_1")
        .await
        .unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.credits_consumed_cents, 1_800);
    assert_eq!(snap.uncovered_cents, 0);

    // Re-enabling overage must not collect that stale charge.
    let snap = svc.update_overage(&payer, true, 10_000).await.unwrap();
    assert_eq!(snap.overage_charged_cents, 0);
    let charges = repo.charges();
    assert_eq!(charges.len(), 1);
    assert_eq!(charges[0].status, OverageChargeStatus::Failed);
    assert!(payments.opened().is_empty());
    assert!(payments.payments().is_empty());
}

#[tokio::test]
async fn failed_invoiced_charge_keeps_coverage_when_credits_are_bought() {
    let (svc, repo, payments, _) = premium_service(7_000);
    let payer = user("payer@x.com");
    payments.set_pay(PayOutcome::Error);

    svc.update_overage(&payer, true, 10_000).await.unwrap();
    let first = repo.charges().into_iter().next().unwrap();
    assert_eq!(first.amount_cents, 3_000);
    assert_eq!(first.status, OverageChargeStatus::Failed);
    assert!(first.invoice.is_some());

    payments.set_pay(PayOutcome::Declined);
    svc.apply_credit_purchase(&payer, 1_000, "cs_shrink")
        .await
        .unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.credits_consumed_cents, 0);
    assert_eq!(snap.credit_balance_cents, 1_000);
    assert_eq!(snap.overage_charged_cents, 3_000);

    svc.update_overage(&payer, true, 10_000).await.unwrap();
    let charges = repo.charges();
    assert_eq!(charges.len(), 1);
    assert_eq!(charges[0].id, first.id);
    assert_eq!(charges[0].status, OverageChargeStatus::Pending);
    assert_eq!(charges[0].amount_cents, 3_000);
    assert_eq!(charges[0].invoice, first.invoice);
    assert_eq!(payments.opened().len(), 1);
    assert_eq!(payments.payments().len(), 2);
}

#[tokio::test]
async fn a_declined_card_leaves_the_invoice_open_for_the_webhook() {
    let (svc, repo, payments, _) = premium_service(5_500);
    let payer = user("payer@x.com");
    payments.set_pay(PayOutcome::Declined);

    let snap = svc.update_overage(&payer, true, 5_000).await.unwrap();
    // Not suspended yet: Stripe retries, the webhook decides.
    assert!(!snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 1_500);
    let charges = repo.charges();
    assert_eq!(charges[0].status, OverageChargeStatus::Pending);
    let invoice = charges[0].invoice.clone().unwrap();

    svc.mark_overage_invoice(&invoice, false).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(snap.overage_suspended);
    // Stripe may still retry the open invoice, so it remains coverage.
    assert_eq!(snap.overage_charged_cents, 1_500);
}

#[tokio::test]
async fn only_the_payer_manages_billing_and_needs_a_paid_plan() {
    let owner = user("owner@x.com");
    let member = user("member@x.com");
    let team = Entitlement {
        tier: PlanTier::Premium,
        seat_tiers: vec![PlanTier::Premium, PlanTier::Premium],
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
        Environment::Develop,
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

    // A member's snapshot shows their own seat allowance but no payer controls.
    let snap = svc.snapshot(&member).await.unwrap();
    assert!(!snap.can_manage_billing);
    assert_eq!(snap.seats, 2);
    assert_eq!(snap.included_cents, 4_000);
}

#[tokio::test]
async fn team_seats_keep_allowances_separate_and_share_credits() {
    let owner = user("owner@x.com");
    let member = user("member@x.com");
    let team = Entitlement {
        tier: PlanTier::Premium,
        seat_tiers: vec![PlanTier::Premium, PlanTier::Premium],
        unlimited: false,
        payer: owner.clone(),
        billed_users: vec![owner.clone(), member.clone()],
        scope: PayerScope::TeamOwner {
            team_id: macro_uuid::generate_uuid_v7(),
        },
    };
    let entitlements = FakeEntitlements::default()
        .with(team)
        .with_customer(&owner, "cus_owner");
    let usage = FakeUsage::default();
    usage.add(&member, Utc::now(), 5_000);
    let repo = FakeRepo::default();
    let service = BillingServiceImpl::new(
        entitlements,
        usage,
        repo.clone(),
        FakePayments::default(),
        Environment::Develop,
    );

    let owner_snapshot = service.snapshot(&owner).await.unwrap();
    assert_eq!(owner_snapshot.used_cents, 0);
    assert_eq!(owner_snapshot.included_cents, 4_000);
    let member_snapshot = service.snapshot(&member).await.unwrap();
    assert_eq!(member_snapshot.used_cents, 5_000);
    assert_eq!(member_snapshot.included_cents, 4_000);
    assert_eq!(
        member_snapshot.blocked_reason,
        Some(DenyReason::AllowanceExhausted)
    );

    service
        .apply_credit_purchase(&owner, 2_500, "cs_team")
        .await
        .unwrap();
    let member_snapshot = service.snapshot(&member).await.unwrap();
    assert_eq!(member_snapshot.credits_consumed_cents, 1_000);
    assert_eq!(member_snapshot.credit_balance_cents, 1_500);
    assert_eq!(member_snapshot.blocked_reason, None);
    assert_eq!(repo.state.lock().unwrap().balance, 1_500);
}

#[tokio::test]
async fn overage_invoice_webhooks_update_suspension() {
    let (svc, repo, payments, _) = premium_service(5_500);
    let payer = user("payer@x.com");
    payments.set_pay(PayOutcome::Declined);
    svc.update_overage(&payer, true, 5_000).await.unwrap();
    let invoice = repo.charges()[0].invoice.clone().unwrap();

    svc.mark_overage_invoice(&invoice, false).await.unwrap();
    assert!(svc.snapshot(&payer).await.unwrap().overage_suspended);

    // Stripe's own retry collected it.
    svc.mark_overage_invoice(&invoice, true).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(!snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 1_500);

    // Paid is terminal: a late or duplicate failure changes nothing.
    svc.mark_overage_invoice(&invoice, false).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(!snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 1_500);
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Paid);

    // Unknown invoices are ignored.
    svc.mark_overage_invoice("in_unknown", false).await.unwrap();
    assert!(!svc.snapshot(&payer).await.unwrap().overage_suspended);
}

#[tokio::test]
async fn out_of_order_invoice_webhooks_follow_the_newest_charge() {
    let (svc, repo, payments, usage) = premium_service(6_000);
    let payer = user("payer@x.com");
    payments.set_pay(PayOutcome::Declined);
    // Charge A: 2_000 over, declined, awaiting Stripe.
    svc.update_overage(&payer, true, 10_000).await.unwrap();
    // Charge B: another 1_500, also declined.
    *usage.cents.lock().unwrap() = 7_500;
    svc.settle(&payer).await.unwrap();
    let charges = repo.charges();
    assert_eq!(charges.len(), 2);
    let (a, b) = (
        charges[0].invoice.clone().unwrap(),
        charges[1].invoice.clone().unwrap(),
    );

    // B fails: suspended.
    svc.mark_overage_invoice(&b, false).await.unwrap();
    assert!(svc.snapshot(&payer).await.unwrap().overage_suspended);
    // A late `paid` for the older A must not lift B's suspension.
    svc.mark_overage_invoice(&a, true).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 3_500);
    // B eventually collects: cleared, everything covered.
    svc.mark_overage_invoice(&b, true).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(!snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 3_500);

    // The mirror image: a late failure for an older invoice after the newest
    // charge went through does not re-suspend.
    let (svc, repo, payments, usage) = premium_service(6_000);
    payments.set_pay(PayOutcome::Declined);
    svc.update_overage(&payer, true, 10_000).await.unwrap();
    *usage.cents.lock().unwrap() = 7_500;
    svc.settle(&payer).await.unwrap();
    let charges = repo.charges();
    let (a, b) = (
        charges[0].invoice.clone().unwrap(),
        charges[1].invoice.clone().unwrap(),
    );
    svc.mark_overage_invoice(&b, true).await.unwrap();
    svc.mark_overage_invoice(&a, false).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(!snap.overage_suspended);
    // A remains coverage because its invoice can still collect. Settlement
    // retries that same invoice rather than replacing it.
    assert_eq!(snap.overage_charged_cents, 3_500);
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Failed);
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

fn anchored_premium(
    used_cents: i64,
) -> (
    Service,
    FakeRepo,
    FakePayments,
    FakeUsage,
    FakeEntitlements,
    MacroUserIdStr<'static>,
    BillingPeriod,
    BillingPeriod,
) {
    let payer = user("payer@x.com");
    let ents = FakeEntitlements::default()
        .with(Entitlement::personal(payer.clone(), PlanTier::Premium))
        .with_customer(&payer, "cus_123");
    let usage = FakeUsage {
        cents: Arc::new(Mutex::new(used_cents)),
        entries: Default::default(),
    };
    let repo = FakeRepo::default();
    let payments = FakePayments::default();
    let svc = BillingServiceImpl::new(
        ents.clone(),
        usage.clone(),
        repo.clone(),
        payments.clone(),
        Environment::Develop,
    );
    let current_start = Utc::now() - chrono::Duration::days(3);
    let current_end = current_start + chrono::Duration::days(30);
    let current = BillingPeriod {
        start: current_start,
        end: current_end,
    };
    let previous = current.previous();
    (svc, repo, payments, usage, ents, payer, previous, current)
}

#[tokio::test]
async fn snapshot_freezes_the_open_period_allowance_and_refreshes_it() {
    let (svc, repo, _, _, ents, payer, _, current) = anchored_premium(0);
    svc.sync_period(&payer, current.start, current.end)
        .await
        .unwrap();
    svc.snapshot(&payer).await.unwrap();
    let frozen = repo.allowance(current.start).expect("open period frozen");
    assert_eq!(
        frozen.seats,
        vec![SeatAllowance {
            user: payer.clone(),
            included_cents: 4_000,
        }]
    );

    ents.set(Entitlement::personal(payer.clone(), PlanTier::Max));
    svc.snapshot(&payer).await.unwrap();
    let frozen = repo
        .allowance(current.start)
        .expect("open period refreshed");
    assert_eq!(frozen.seats[0].included_cents, 20_000);
}

#[tokio::test]
async fn previous_period_overage_survives_an_upgrade() {
    let (svc, repo, payments, usage, ents, payer, previous, current) = anchored_premium(0);
    svc.sync_period(&payer, current.start, current.end)
        .await
        .unwrap();
    repo.freeze(
        previous.start,
        PeriodAllowance {
            seats: vec![SeatAllowance {
                user: payer.clone(),
                included_cents: 4_000,
            }],
        },
    );
    svc.update_overage(&payer, true, 10_000).await.unwrap();
    usage.add(&payer, previous.start + chrono::Duration::days(2), 5_500);

    ents.set(Entitlement::personal(payer.clone(), PlanTier::Max));
    svc.settle(&payer).await.unwrap();

    let opened = payments.opened();
    assert_eq!(opened.len(), 1);
    // 5_500 used against the frozen Premium 4_000, not Max's 20_000.
    assert_eq!(opened[0].amount_cents, 1_500);
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Paid);
    // The open period freeze now reflects Max; the closed one does not.
    assert_eq!(
        repo.allowance(previous.start).unwrap().seats[0].included_cents,
        4_000
    );
    assert_eq!(
        repo.allowance(current.start).unwrap().seats[0].included_cents,
        20_000
    );
}

#[tokio::test]
async fn previous_period_does_not_charge_included_usage_after_a_downgrade() {
    let (svc, repo, payments, usage, ents, payer, previous, current) = anchored_premium(0);
    svc.sync_period(&payer, current.start, current.end)
        .await
        .unwrap();
    repo.freeze(
        previous.start,
        PeriodAllowance {
            seats: vec![SeatAllowance {
                user: payer.clone(),
                included_cents: 20_000,
            }],
        },
    );
    svc.update_overage(&payer, true, 10_000).await.unwrap();
    usage.add(&payer, previous.start + chrono::Duration::days(2), 10_000);

    ents.set(Entitlement::personal(payer.clone(), PlanTier::Premium));
    svc.settle(&payer).await.unwrap();

    assert!(payments.opened().is_empty());
    assert!(repo.charges().is_empty());
}

#[tokio::test]
async fn previous_period_usage_uses_the_frozen_billed_users() {
    let owner = user("owner@x.com");
    let member_a = user("a@x.com");
    let member_b = user("b@x.com");
    let team_id = macro_uuid::generate_uuid_v7();
    let old_team = Entitlement {
        tier: PlanTier::Premium,
        seat_tiers: vec![PlanTier::Premium, PlanTier::Premium],
        unlimited: false,
        payer: owner.clone(),
        billed_users: vec![owner.clone(), member_a.clone()],
        scope: PayerScope::TeamOwner { team_id },
    };
    let new_team = Entitlement {
        billed_users: vec![owner.clone(), member_b.clone()],
        ..old_team.clone()
    };
    let ents = FakeEntitlements::default()
        .with(old_team.clone())
        .with_customer(&owner, "cus_owner");
    let usage = FakeUsage::default();
    let repo = FakeRepo::default();
    let payments = FakePayments::default();
    let svc = BillingServiceImpl::new(
        ents.clone(),
        usage.clone(),
        repo.clone(),
        payments.clone(),
        Environment::Develop,
    );
    let current_start = Utc::now() - chrono::Duration::days(3);
    let current_end = current_start + chrono::Duration::days(30);
    let current = BillingPeriod {
        start: current_start,
        end: current_end,
    };
    let previous = current.previous();
    svc.sync_period(&owner, current.start, current.end)
        .await
        .unwrap();
    repo.freeze(
        previous.start,
        PeriodAllowance {
            seats: vec![
                SeatAllowance {
                    user: owner.clone(),
                    included_cents: 4_000,
                },
                SeatAllowance {
                    user: member_a.clone(),
                    included_cents: 4_000,
                },
            ],
        },
    );
    usage.add(&member_a, previous.start + chrono::Duration::days(2), 9_200);
    usage.add(
        &member_b,
        previous.start + chrono::Duration::days(2),
        50_000,
    );
    ents.set(new_team);
    svc.update_overage(&owner, true, 10_000).await.unwrap();
    svc.settle(&owner).await.unwrap();

    let opened = payments.opened();
    assert_eq!(opened.len(), 1);
    // Member A gets only their own $40 allowance, so 5_200 is chargeable.
    // The owner's unused allowance does not offset it. Member B's usage is
    // ignored because they were not a billed user in that period.
    assert_eq!(opened[0].amount_cents, 5_200);
}

#[tokio::test]
async fn current_period_uses_the_live_allowance_after_an_upgrade() {
    let (svc, repo, payments, usage, ents, payer, previous, current) = anchored_premium(0);
    svc.sync_period(&payer, current.start, current.end)
        .await
        .unwrap();
    repo.freeze(
        previous.start,
        PeriodAllowance {
            seats: vec![SeatAllowance {
                user: payer.clone(),
                included_cents: 4_000,
            }],
        },
    );
    svc.update_overage(&payer, true, 10_000).await.unwrap();
    // Current-period usage that exceeds Premium but sits inside Max.
    *usage.cents.lock().unwrap() = 10_000;
    ents.set(Entitlement::personal(payer.clone(), PlanTier::Max));
    svc.settle(&payer).await.unwrap();
    assert!(payments.opened().is_empty());
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.included_cents, 20_000);
    assert_eq!(snap.used_cents, 10_000);
    assert_eq!(snap.uncovered_cents, 0);
}

fn open_anchor(now: DateTime<Utc>) -> (DateTime<Utc>, DateTime<Utc>, OpenPeriodStart) {
    let start = now - chrono::Duration::days(1);
    let end = now + chrono::Duration::days(20);
    let open = BillingPeriod::current(Some((start, end)), now)
        .open_start(now)
        .unwrap();
    (start, end, open)
}

#[tokio::test]
async fn release_targets_the_payer_open_period() {
    let now = Utc::now();
    let (start, end, open) = open_anchor(now);
    let owner = user("owner@x.com");
    let member = user("member@x.com");
    let team_id = Uuid::from_u128(7);
    let repo = FakeRepo::default();
    repo.set_period(&owner, start, end).await.unwrap();
    let ents = FakeEntitlements::default().payer_for_team(team_id, owner.clone());
    let svc = BillingServiceImpl::new(
        ents,
        FakeUsage::default(),
        repo.clone(),
        FakePayments::default(),
        Environment::Develop,
    );

    svc.release(team_id, &member).await.unwrap();

    assert_eq!(
        repo.releases(),
        vec![(
            owner.as_ref().to_string(),
            open.start(),
            member.as_ref().to_string()
        )]
    );
    assert!(repo.allowance(open.start()).is_none());
}

#[tokio::test]
async fn release_missing_team_leaves_allowances_unchanged() {
    let member = user("member@x.com");
    let repo = FakeRepo::default();
    let period_start = Utc::now();
    repo.freeze(
        period_start,
        PeriodAllowance {
            seats: vec![SeatAllowance {
                user: member.clone(),
                included_cents: 4_000,
            }],
        },
    );
    let svc = BillingServiceImpl::new(
        FakeEntitlements::default(),
        FakeUsage::default(),
        repo.clone(),
        FakePayments::default(),
        Environment::Develop,
    );

    svc.release(Uuid::from_u128(8), &member).await.unwrap();

    assert!(repo.releases().is_empty());
    assert_eq!(
        repo.allowance(period_start).unwrap().seats,
        vec![SeatAllowance {
            user: member,
            included_cents: 4_000,
        }]
    );
}

#[tokio::test]
async fn release_refuses_to_remove_the_payer() {
    let now = Utc::now();
    let (start, end, open) = open_anchor(now);
    let owner = user("owner@x.com");
    let team_id = Uuid::from_u128(9);
    let repo = FakeRepo::default();
    repo.set_period(&owner, start, end).await.unwrap();
    repo.freeze(
        open.start(),
        PeriodAllowance {
            seats: vec![SeatAllowance {
                user: owner.clone(),
                included_cents: 4_000,
            }],
        },
    );
    let ents = FakeEntitlements::default().payer_for_team(team_id, owner.clone());
    let svc = BillingServiceImpl::new(
        ents,
        FakeUsage::default(),
        repo.clone(),
        FakePayments::default(),
        Environment::Develop,
    );

    svc.release(team_id, &owner).await.unwrap();

    assert!(repo.releases().is_empty());
    assert_eq!(
        repo.allowance(open.start()).unwrap().seats,
        vec![SeatAllowance {
            user: owner,
            included_cents: 4_000,
        }]
    );
}

#[tokio::test]
async fn position_keeps_matching_pairs_in_their_stored_order() {
    let now = Utc::now();
    let (start, end, open) = open_anchor(now);
    let owner = user("owner@x.com");
    let member = user("member@x.com");
    let team_id = Uuid::from_u128(10);
    let entitlement = Entitlement {
        tier: PlanTier::Premium,
        seat_tiers: vec![PlanTier::Premium, PlanTier::Max],
        unlimited: false,
        payer: owner.clone(),
        billed_users: vec![owner.clone(), member.clone()],
        scope: PayerScope::TeamOwner { team_id },
    };
    let stored = vec![
        SeatAllowance {
            user: member.clone(),
            included_cents: 20_000,
        },
        SeatAllowance {
            user: owner.clone(),
            included_cents: 4_000,
        },
    ];
    let repo = FakeRepo::default();
    repo.set_period(&owner, start, end).await.unwrap();
    repo.freeze(
        open.start(),
        PeriodAllowance {
            seats: stored.clone(),
        },
    );
    let svc = BillingServiceImpl::new(
        FakeEntitlements::default().with(entitlement),
        FakeUsage::default(),
        repo.clone(),
        FakePayments::default(),
        Environment::Develop,
    );

    svc.position(&owner, now).await.unwrap();

    assert_eq!(repo.allowance(open.start()).unwrap().seats, stored);
}

#[tokio::test]
async fn position_does_not_restore_a_member_released_between_entitlement_reads() {
    let now = Utc::now();
    let (start, end, open) = open_anchor(now);
    let owner = user("owner@x.com");
    let member = user("member@x.com");
    let bob = user("bob@x.com");
    let team_id = Uuid::from_u128(11);
    let before = Entitlement {
        tier: PlanTier::Premium,
        seat_tiers: vec![PlanTier::Premium, PlanTier::Premium],
        unlimited: false,
        payer: owner.clone(),
        billed_users: vec![owner.clone(), member.clone()],
        scope: PayerScope::TeamOwner { team_id },
    };
    let after = Entitlement {
        billed_users: vec![owner.clone()],
        seat_tiers: vec![PlanTier::Premium],
        ..before.clone()
    };
    let repo = FakeRepo::default();
    repo.set_period(&owner, start, end).await.unwrap();
    repo.freeze(
        open.start(),
        PeriodAllowance {
            seats: vec![
                SeatAllowance {
                    user: owner.clone(),
                    included_cents: 100,
                },
                SeatAllowance {
                    user: member.clone(),
                    included_cents: 100,
                },
                SeatAllowance {
                    user: bob.clone(),
                    included_cents: 300,
                },
            ],
        },
    );
    let ents = ReleaseOnSecondRead {
        calls: Arc::new(Mutex::new(0)),
        before,
        after: after.clone(),
        repo: repo.clone(),
        open,
        member: member.clone(),
    };
    let svc = BillingServiceImpl::new(
        ents,
        FakeUsage::default(),
        repo.clone(),
        FakePayments::default(),
        Environment::Develop,
    );

    let position = svc.position(&owner, now).await.unwrap();

    assert_eq!(position.entitlement.billed_users, after.billed_users);
    assert_eq!(
        repo.allowance(open.start()).unwrap().seats,
        vec![
            SeatAllowance {
                user: owner,
                included_cents: 100,
            },
            SeatAllowance {
                user: bob,
                included_cents: 300,
            },
        ]
    );
}

struct ReleaseOnSecondRead {
    calls: Arc<Mutex<u32>>,
    before: Entitlement,
    after: Entitlement,
    repo: FakeRepo,
    open: OpenPeriodStart,
    member: MacroUserIdStr<'static>,
}

impl EntitlementSource for ReleaseOnSecondRead {
    async fn entitlement(&self, _user: &MacroUserIdStr<'_>) -> Result<Entitlement> {
        let first_read = {
            let mut calls = self.calls.lock().unwrap();
            *calls += 1;
            *calls == 1
        };
        if first_read {
            Ok(self.before.clone())
        } else {
            self.repo
                .release_open_seat(&self.before.payer, self.open, &self.member)
                .await?;
            Ok(self.after.clone())
        }
    }

    async fn stripe_customer_id(&self, _user: &MacroUserIdStr<'_>) -> Result<Option<String>> {
        Ok(None)
    }

    async fn team_payer(&self, _team_id: Uuid) -> Result<Option<MacroUserIdStr<'static>>> {
        Ok(None)
    }
}
