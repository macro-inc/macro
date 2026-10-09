use super::*;
use crate::domain::ledger::{ReloadState, plan_reload, plan_settlement};
use crate::domain::models::{
    AllowanceStore, AutoReloadThresholds, CreditReloadStatus, DenyReason, OVERAGE_LIMIT_MIN_CENTS,
    OpenPeriodStart, PayerScope, PaymentAction, PeriodAllowance, PeriodLedger, PlanTier,
    SeatGeneration,
};
use crate::domain::ports::{
    CreditReloadRequest, OverageChargeRequest, PendingCharge, PendingReload, ResolvedReload,
    SettlementOutcome, StaleInvoice,
};
use chrono::TimeZone;
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
    fail_entitlement: Arc<Mutex<bool>>,
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
        if *self.fail_entitlement.lock().unwrap() {
            return Err(BillingError::Entitlement(anyhow::anyhow!(
                "roles unavailable"
            )));
        }
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
    async fn usage_cost_cents_by_user(
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
    hosted_invoice_url: Option<String>,
    updated_at: DateTime<Utc>,
}

/// One `ai_credit_reload` row.
#[derive(Debug, Clone)]
struct FakeReload {
    id: Uuid,
    amount_cents: i64,
    status: CreditReloadStatus,
    invoice: Option<String>,
    hosted_invoice_url: Option<String>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
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
    reloads: Vec<FakeReload>,
    auto_reload_suspended: bool,
    allowances: HashMap<DateTime<Utc>, PeriodAllowance>,
    releases: Vec<(String, DateTime<Utc>, String)>,
    activated_seats: Vec<String>,
    period_writes: Vec<(String, DateTime<Utc>, DateTime<Utc>)>,
}

impl RepoState {
    fn ledger(&self, period_start: DateTime<Utc>) -> PeriodLedger {
        PeriodLedger {
            credits_consumed_cents: self.consumed.get(&period_start).copied().unwrap_or(0),
            // A charge Stripe may still collect keeps covering its usage.
            overage_charged_cents: self
                .charges
                .iter()
                .filter(|c| {
                    c.period_start == period_start && c.status.may_collect(c.invoice.is_some())
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
    /// A direct charge issued before settlement stopped collecting overage.
    fn historical_charge(&self, invoice: &str, amount_cents: i64) {
        self.state.lock().unwrap().charges.push(FakeCharge {
            id: macro_uuid::generate_uuid_v7(),
            period_start: BillingPeriod::current(None, Utc::now()).start,
            amount_cents,
            status: OverageChargeStatus::Pending,
            invoice: Some(invoice.to_string()),
            hosted_invoice_url: None,
            updated_at: Utc::now(),
        });
    }
    fn reloads(&self) -> Vec<FakeReload> {
        self.state.lock().unwrap().reloads.clone()
    }
    fn set_balance(&self, cents: i64) {
        self.state.lock().unwrap().balance = cents;
    }
    /// Overage without automatic reloads, as after a failed reload charge.
    /// Overage tests that start with no credits use this so the default
    /// thresholds do not top the balance up before the chunk is reserved.
    fn pause_reloads(&self) {
        self.state.lock().unwrap().auto_reload_suspended = true;
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
    fn period_writes(&self) -> Vec<(String, DateTime<Utc>, DateTime<Utc>)> {
        self.state.lock().unwrap().period_writes.clone()
    }
    /// Backdate every row's last change, as if the webhook had been silent
    /// since.
    fn age_invoices(&self, by: chrono::Duration) {
        let mut s = self.state.lock().unwrap();
        for c in s.charges.iter_mut() {
            c.updated_at -= by;
        }
        for r in s.reloads.iter_mut() {
            r.updated_at -= by;
        }
    }
}

impl BillingRepo for FakeRepo {
    async fn legacy_seats(
        &self,
        _payer: &MacroUserIdStr<'_>,
        _period: BillingPeriod,
        mut seats: Vec<SeatAllowance>,
    ) -> Result<Vec<SeatAllowance>> {
        let state = self.state.lock().unwrap();
        seats.retain(|seat| {
            !state
                .activated_seats
                .iter()
                .any(|user| user == seat.user.as_ref())
        });
        Ok(seats)
    }

    async fn settings(&self, _payer: &MacroUserIdStr<'_>) -> Result<BillingSettings> {
        let s = self.state.lock().unwrap();
        let mut settings = s.settings.clone();
        settings.overage_suspended_at = s.suspended.then(Utc::now);
        settings.auto_reload_suspended_at = s.auto_reload_suspended.then(Utc::now);
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
        payer: &MacroUserIdStr<'_>,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
    ) -> Result<()> {
        let mut state = self.state.lock().unwrap();
        // Same guard as `PgBillingRepo::set_period`, which returns `Ok` when it refuses a write.
        let applies = match state.settings.period_anchor {
            None => true,
            Some((stored_start, stored_end)) => {
                (start > stored_start && start >= stored_end)
                    || (start == stored_start && end > start)
            }
        };
        if applies {
            state.settings.period_anchor = Some((start, end));
        }
        state
            .period_writes
            .push((payer.as_ref().to_string(), start, end));
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
    async fn frozen_period_starts(
        &self,
        _payer: &MacroUserIdStr<'_>,
        since: DateTime<Utc>,
        before: DateTime<Utc>,
    ) -> Result<Vec<DateTime<Utc>>> {
        let mut starts: Vec<DateTime<Utc>> = self
            .state
            .lock()
            .unwrap()
            .allowances
            .keys()
            .copied()
            .filter(|start| since <= *start && *start < before)
            .collect();
        starts.sort_unstable();
        Ok(starts)
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
        chargeable_customer_cents: i64,
        policy: SettlementPolicy,
    ) -> Result<SettlementOutcome> {
        let mut s = self.state.lock().unwrap();
        let ledger = s.ledger(period_start);
        let overage_active = policy.overage_active
            && s.settings.overage_enabled
            && !s.suspended
            && s.settings.overage_limit_cents > 0;
        let plan = plan_settlement(
            crate::domain::ledger::SettlementState {
                chargeable_customer_cents,
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
            policy.overage_active
                && c.period_start == period_start
                && ((c.status == OverageChargeStatus::Pending && c.invoice.is_none())
                    || (matches!(
                        c.status,
                        OverageChargeStatus::Failed | OverageChargeStatus::RequiresAction
                    ) && overage_active
                        && (c.invoice.is_some() || c.amount_cents <= plan.charge_overage_cents)))
        });
        let pending_charge = if let Some(i) = owed {
            s.charges[i].status = OverageChargeStatus::Pending;
            s.charges[i].updated_at = Utc::now();
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
                hosted_invoice_url: None,
                updated_at: Utc::now(),
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
            c.updated_at = Utc::now();
            if let Some(inv) = stripe_invoice_id {
                c.invoice = Some(inv.to_string());
            }
        }
        Ok(())
    }
    async fn resolve_overage_invoice(
        &self,
        stripe_invoice_id: &str,
        outcome: &InvoiceOutcome,
    ) -> Result<Option<MacroUserIdStr<'static>>> {
        let next = outcome.charge_status();
        let mut s = self.state.lock().unwrap();
        let found = s
            .charges
            .iter_mut()
            .find(|c| c.invoice.as_deref() == Some(stripe_invoice_id) && c.status.accepts(next));
        Ok(found.map(|c| {
            c.status = next;
            c.updated_at = Utc::now();
            if let Some(url) = outcome.hosted_invoice_url() {
                c.hosted_invoice_url = Some(url.to_string());
            }
            user("payer@x.com")
        }))
    }
    async fn latest_charge_status(
        &self,
        _payer: &MacroUserIdStr<'_>,
    ) -> Result<Option<OverageChargeStatus>> {
        Ok(self.state.lock().unwrap().charges.last().map(|c| c.status))
    }
    async fn update_auto_reload(
        &self,
        _payer: &MacroUserIdStr<'_>,
        enabled: bool,
        overage_limit_cents: i64,
        thresholds: Option<&AutoReloadThresholds>,
    ) -> Result<()> {
        let mut s = self.state.lock().unwrap();
        s.settings.overage_enabled = enabled;
        s.settings.overage_limit_cents = overage_limit_cents;
        if let Some(thresholds) = thresholds {
            s.settings.auto_reload = *thresholds;
        }
        s.suspended = false;
        s.auto_reload_suspended = false;
        Ok(())
    }
    /// Mirrors the Postgres adapter: a stale uninvoiced reload is handed
    /// back, a failed or action-required one with an invoice is retried, any
    /// other collectible reload blocks, otherwise plan a new one.
    async fn reserve_credit_reload(
        &self,
        _payer: &MacroUserIdStr<'_>,
        period_start: DateTime<Utc>,
        chargeable_customer_cents: i64,
        now: DateTime<Utc>,
    ) -> Result<Option<PendingReload>> {
        let mut s = self.state.lock().unwrap();
        let active = s.settings.overage_enabled && !s.auto_reload_suspended;
        if !active {
            return Ok(None);
        }

        let stale_before = now - chrono::Duration::minutes(10);
        let open: Vec<usize> = (0..s.reloads.len())
            .filter(|&i| {
                let r = &s.reloads[i];
                r.status != CreditReloadStatus::Paid && r.status.may_collect(r.invoice.is_some())
            })
            .collect();
        if let Some(&i) = open.iter().find(|&&i| {
            let r = &s.reloads[i];
            r.status == CreditReloadStatus::Pending
                && r.invoice.is_none()
                && r.created_at < stale_before
        }) {
            let orphan = &s.reloads[i];
            return Ok(Some(PendingReload {
                id: orphan.id,
                amount_cents: orphan.amount_cents,
                stripe_invoice_id: orphan.invoice.clone(),
            }));
        }
        if let Some(&i) = open
            .iter()
            .find(|&&i| s.reloads[i].status != CreditReloadStatus::Pending)
        {
            let r = &mut s.reloads[i];
            r.status = CreditReloadStatus::Pending;
            r.updated_at = now;
            return Ok(Some(PendingReload {
                id: r.id,
                amount_cents: r.amount_cents,
                stripe_invoice_id: r.invoice.clone(),
            }));
        }
        if !open.is_empty() {
            return Ok(None);
        }

        let ledger = s.ledger(period_start);
        let covered = ledger.credits_consumed_cents + ledger.overage_charged_cents;
        let month = BillingPeriod::calendar_month(now);
        let spent_this_month_cents = s
            .reloads
            .iter()
            .filter(|r| {
                r.status.may_collect(r.invoice.is_some())
                    && month.start <= r.created_at
                    && r.created_at < month.end
            })
            .map(|r| r.amount_cents)
            .sum();
        let amount_cents = plan_reload(
            ReloadState {
                credit_balance_cents: s.balance,
                uncovered_cents: (chargeable_customer_cents - covered).max(0),
                spent_this_month_cents,
            },
            &s.settings.auto_reload,
        );
        let Some(amount_cents) = amount_cents else {
            return Ok(None);
        };
        let id = macro_uuid::generate_uuid_v7();
        s.reloads.push(FakeReload {
            id,
            amount_cents,
            status: CreditReloadStatus::Pending,
            invoice: None,
            hosted_invoice_url: None,
            created_at: now,
            updated_at: now,
        });
        Ok(Some(PendingReload {
            id,
            amount_cents,
            stripe_invoice_id: None,
        }))
    }
    async fn finish_credit_reload(
        &self,
        reload_id: Uuid,
        stripe_invoice_id: Option<&str>,
        status: CreditReloadStatus,
    ) -> Result<()> {
        let mut s = self.state.lock().unwrap();
        for r in s.reloads.iter_mut().filter(|r| r.id == reload_id) {
            r.status = status;
            r.updated_at = Utc::now();
            if let Some(inv) = stripe_invoice_id {
                r.invoice = Some(inv.to_string());
            }
        }
        Ok(())
    }
    async fn record_credit_reload(
        &self,
        payer: &MacroUserIdStr<'_>,
        amount_cents: i64,
        stripe_invoice_id: &str,
    ) -> Result<bool> {
        self.record_credit_purchase(payer, amount_cents, stripe_invoice_id)
            .await
    }
    async fn resolve_credit_reload_invoice(
        &self,
        stripe_invoice_id: &str,
        outcome: &InvoiceOutcome,
    ) -> Result<Option<ResolvedReload>> {
        let next = outcome.reload_status();
        let mut s = self.state.lock().unwrap();
        let found = s
            .reloads
            .iter_mut()
            .find(|r| r.invoice.as_deref() == Some(stripe_invoice_id) && r.status.accepts(next));
        let resolved = found.map(|r| {
            r.status = next;
            r.updated_at = Utc::now();
            if let Some(url) = outcome.hosted_invoice_url() {
                r.hosted_invoice_url = Some(url.to_string());
            }
            ResolvedReload {
                payer: user("payer@x.com"),
                amount_cents: r.amount_cents,
            }
        });
        if let Some(resolved) = &resolved
            && next == CreditReloadStatus::Paid
            && !s.purchases.iter().any(|r| r == stripe_invoice_id)
        {
            s.purchases.push(stripe_invoice_id.to_string());
            s.balance += resolved.amount_cents;
        }
        Ok(resolved)
    }
    async fn suspend_auto_reload(&self, _payer: &MacroUserIdStr<'_>) -> Result<()> {
        self.state.lock().unwrap().auto_reload_suspended = true;
        Ok(())
    }
    async fn clear_auto_reload_suspension(&self, _payer: &MacroUserIdStr<'_>) -> Result<()> {
        self.state.lock().unwrap().auto_reload_suspended = false;
        Ok(())
    }
    async fn latest_reload_status(
        &self,
        _payer: &MacroUserIdStr<'_>,
    ) -> Result<Option<CreditReloadStatus>> {
        Ok(self.state.lock().unwrap().reloads.last().map(|r| r.status))
    }
    async fn stale_invoices(
        &self,
        _payer: &MacroUserIdStr<'_>,
        before: DateTime<Utc>,
    ) -> Result<Vec<StaleInvoice>> {
        let s = self.state.lock().unwrap();
        let mut stale: Vec<(DateTime<Utc>, StaleInvoice)> = s
            .charges
            .iter()
            .filter(|c| {
                c.status != OverageChargeStatus::Paid
                    && c.status.may_collect(c.invoice.is_some())
                    && c.updated_at < before
            })
            .filter_map(|c| {
                Some((
                    c.updated_at,
                    StaleInvoice {
                        kind: PaymentActionKind::OverageCharge,
                        stripe_invoice_id: c.invoice.clone()?,
                    },
                ))
            })
            .chain(
                s.reloads
                    .iter()
                    .filter(|r| {
                        r.status != CreditReloadStatus::Paid
                            && r.status.may_collect(r.invoice.is_some())
                            && r.updated_at < before
                    })
                    .filter_map(|r| {
                        Some((
                            r.updated_at,
                            StaleInvoice {
                                kind: PaymentActionKind::CreditReload,
                                stripe_invoice_id: r.invoice.clone()?,
                            },
                        ))
                    }),
            )
            .collect();
        stale.sort_by_key(|(at, _)| *at);
        Ok(stale.into_iter().map(|(_, invoice)| invoice).collect())
    }
    async fn payment_action(&self, _payer: &MacroUserIdStr<'_>) -> Result<Option<PaymentAction>> {
        let s = self.state.lock().unwrap();
        let charge = s
            .charges
            .iter()
            .filter(|c| c.status == OverageChargeStatus::RequiresAction)
            .map(|c| {
                (
                    c.updated_at,
                    PaymentAction {
                        kind: PaymentActionKind::OverageCharge,
                        amount_cents: c.amount_cents,
                        hosted_invoice_url: c.hosted_invoice_url.clone(),
                    },
                )
            });
        let reload = s
            .reloads
            .iter()
            .filter(|r| r.status == CreditReloadStatus::RequiresAction)
            .map(|r| {
                (
                    r.updated_at,
                    PaymentAction {
                        kind: PaymentActionKind::CreditReload,
                        amount_cents: r.amount_cents,
                        hosted_invoice_url: r.hosted_invoice_url.clone(),
                    },
                )
            });
        Ok(charge
            .chain(reload)
            .max_by_key(|(at, _)| *at)
            .map(|(_, action)| action))
    }
}

/// How the fake provider answers the next payment attempts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
enum PayOutcome {
    #[default]
    Paid,
    /// Card declined: the invoice stays open for Stripe's retries.
    Declined,
    /// The payment needs the customer to authenticate.
    ActionRequired,
    /// Stripe had already voided the invoice.
    Voided,
    /// The provider could not be reached.
    Error,
}

const HOSTED_INVOICE_URL: &str = "https://invoice.stripe.test/i/in_authenticate";

#[derive(Debug, Clone, Copy, Default)]
enum PeriodReply {
    #[default]
    Missing,
    Found(BillingPeriod),
    Failed,
}

#[derive(Clone, Default)]
struct FakePayments {
    fail_open: Arc<Mutex<bool>>,
    pay_outcome: Arc<Mutex<PayOutcome>>,
    checkouts: Arc<Mutex<Vec<CreditCheckoutRequest>>>,
    opened: Arc<Mutex<Vec<OverageChargeRequest>>>,
    opened_reloads: Arc<Mutex<Vec<CreditReloadRequest>>>,
    payments: Arc<Mutex<Vec<(Uuid, String)>>>,
    period_reply: Arc<Mutex<PeriodReply>>,
    period_requests: Arc<Mutex<Vec<(String, SubscriptionScope)>>>,
    /// What a reconciliation read reports per invoice; unknown invoices are
    /// inconclusive.
    invoice_outcomes: Arc<Mutex<HashMap<String, InvoiceOutcome>>>,
    invoice_reads: Arc<Mutex<Vec<String>>>,
}

impl FakePayments {
    fn set_pay(&self, outcome: PayOutcome) {
        *self.pay_outcome.lock().unwrap() = outcome;
    }
    fn set_invoice_outcome(&self, invoice: &str, outcome: InvoiceOutcome) {
        self.invoice_outcomes
            .lock()
            .unwrap()
            .insert(invoice.to_string(), outcome);
    }
    fn invoice_reads(&self) -> Vec<String> {
        self.invoice_reads.lock().unwrap().clone()
    }
    fn set_period(&self, reply: PeriodReply) {
        *self.period_reply.lock().unwrap() = reply;
    }
    fn period_requests(&self) -> Vec<(String, SubscriptionScope)> {
        self.period_requests.lock().unwrap().clone()
    }
    fn opened(&self) -> Vec<OverageChargeRequest> {
        self.opened.lock().unwrap().clone()
    }
    fn opened_reloads(&self) -> Vec<CreditReloadRequest> {
        self.opened_reloads.lock().unwrap().clone()
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
    async fn open_credit_reload_invoice(&self, request: CreditReloadRequest) -> Result<String> {
        if *self.fail_open.lock().unwrap() {
            return Err(BillingError::Payment(anyhow::anyhow!("stripe unavailable")));
        }
        let invoice = format!("in_{}", request.reload_id);
        self.opened_reloads.lock().unwrap().push(request);
        Ok(invoice)
    }
    async fn pay_overage_invoice(
        &self,
        charge_id: Uuid,
        invoice_id: &str,
        _scope: SubscriptionScope,
    ) -> Result<InvoiceOutcome> {
        self.payments
            .lock()
            .unwrap()
            .push((charge_id, invoice_id.to_string()));
        match *self.pay_outcome.lock().unwrap() {
            PayOutcome::Paid => Ok(InvoiceOutcome::Paid),
            PayOutcome::Declined => Ok(InvoiceOutcome::PaymentFailed),
            PayOutcome::ActionRequired => Ok(InvoiceOutcome::ActionRequired {
                hosted_invoice_url: Some(HOSTED_INVOICE_URL.to_string()),
            }),
            PayOutcome::Voided => Ok(InvoiceOutcome::Voided),
            PayOutcome::Error => Err(BillingError::Payment(anyhow::anyhow!("card declined"))),
        }
    }
    async fn invoice_outcome(&self, invoice_id: &str) -> Result<Option<InvoiceOutcome>> {
        self.invoice_reads
            .lock()
            .unwrap()
            .push(invoice_id.to_string());
        Ok(self
            .invoice_outcomes
            .lock()
            .unwrap()
            .get(invoice_id)
            .cloned())
    }
    async fn subscription_period(
        &self,
        customer_id: &str,
        scope: SubscriptionScope,
    ) -> Result<Option<BillingPeriod>> {
        self.period_requests
            .lock()
            .unwrap()
            .push((customer_id.to_string(), scope));
        match *self.period_reply.lock().unwrap() {
            PeriodReply::Missing => Ok(None),
            PeriodReply::Found(period) => Ok(Some(period)),
            PeriodReply::Failed => {
                Err(BillingError::Payment(anyhow::anyhow!("stripe unavailable")))
            }
        }
    }
}

#[derive(Default)]
struct FakePeriodSync(Mutex<Vec<SubscriptionPeriod>>);

impl PeriodSync for FakePeriodSync {
    fn sync<'a>(
        &'a self,
        _payer: MacroUserIdStr<'static>,
        observation: SubscriptionPeriod,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<()>> + Send + 'a>> {
        Box::pin(async move {
            self.0.lock().unwrap().push(observation);
            Ok(())
        })
    }
}

#[tokio::test]
async fn period_sync_is_gated_and_never_calls_payments_or_changes_item_anchors() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    let start = Utc::now();
    let end = start + chrono::Duration::days(31);
    let facts = SubscriptionPeriod {
        event_id: "evt_period".parse().unwrap(),
        event_at: start,
        subscription_id: "sub_verified".parse().unwrap(),
        subscription_created_at: start,
        customer_id: "cus_123".parse().unwrap(),
        team_id: None,
        quantity: 1,
        item_count: 1,
        item_id: "si_verified".parse().unwrap(),
        price_id: "price_verified".parse().unwrap(),
        product_id: "prod_verified".parse().unwrap(),
        unit_amount: Some(4000),
        currency: "usd".into(),
        monthly: true,
        activity: super::super::period::SubscriptionActivity::Active,
        period: BillingPeriod { start, end },
        evidence: super::super::period::PeriodEvidence::Initial,
    };
    svc.sync_period(&payer, start, end, Some(facts.clone()))
        .await
        .unwrap();
    assert!(repo.settings(&payer).await.unwrap().period_anchor.is_none());
    let sync = Arc::new(FakePeriodSync::default());
    let svc = svc.with_period_sync(sync.clone());
    svc.sync_period(&payer, start, end, None).await.unwrap();
    assert!(sync.0.lock().unwrap().is_empty());
    svc.sync_period(&payer, start, end, Some(facts.clone()))
        .await
        .unwrap();
    assert_eq!(*sync.0.lock().unwrap(), vec![facts.clone()]);
    svc.sync_period(&payer, start, end + chrono::Duration::days(1), Some(facts))
        .await
        .unwrap();
    assert_eq!(sync.0.lock().unwrap().len(), 1);
    assert!(payments.opened().is_empty());
    assert!(payments.payments().is_empty());
    assert!(payments.checkouts.lock().unwrap().is_empty());
}

type Service = BillingServiceImpl<FakeEntitlements, FakeUsage, FakeRepo, FakePayments>;

fn thresholds(minimum: i64, target: i64, monthly_limit: Option<i64>) -> AutoReloadThresholds {
    AutoReloadThresholds {
        minimum_cents: minimum,
        target_cents: target,
        monthly_limit_cents: monthly_limit,
    }
}

fn premium_service(used_cents: i64) -> (Service, FakeRepo, FakePayments, FakeUsage) {
    premium_service_with(AiUsageBilling::Enabled, used_cents)
}

fn premium_service_with(
    billing: AiUsageBilling,
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
            AiPricing::testing(),
        )
        .with_enforcement(AiUsageEnforcement::Enabled)
        .with_billing(billing),
        repo,
        payments,
        usage,
    )
}

#[tokio::test]
async fn recorded_new_policy_never_enters_legacy_analytics_settlement() {
    let (svc, repo, payments, _) = premium_service(100_000);
    let payer = user("payer@x.com");
    {
        let mut state = repo.state.lock().unwrap();
        state.activated_seats.push(payer.as_ref().to_owned());
        state.balance = 10_000;
        state.settings.overage_enabled = true;
        state.settings.overage_limit_cents = 10_000;
    }
    svc.settle(&payer).await.unwrap();
    assert!(repo.state.lock().unwrap().consumed.is_empty());
    assert!(repo.charges().is_empty());
    assert!(payments.opened().is_empty());
    assert_eq!(repo.state.lock().unwrap().balance, 10_000);
}

#[tokio::test]
async fn unlimited_payers_are_never_charged_overage_or_gated() {
    let payer = user("unlimited@x.com");
    let entitlements = FakeEntitlements::default()
        .with(Entitlement {
            unlimited: true,
            ..Entitlement::personal(payer.clone(), PlanTier::Premium)
        })
        .with_customer(&payer, "cus_unlimited");
    let usage = FakeUsage {
        cents: Arc::new(Mutex::new(50_000)),
        entries: Default::default(),
    };
    let repo = FakeRepo::default();
    let payments = FakePayments::default();
    {
        let mut state = repo.state.lock().unwrap();
        state.balance = 10_000;
        state.settings.overage_enabled = true;
        state.settings.overage_limit_cents = 10_000;
    }
    let svc = BillingServiceImpl::new(
        entitlements,
        usage,
        repo.clone(),
        payments.clone(),
        AiPricing::testing(),
    )
    .with_enforcement(AiUsageEnforcement::Enabled)
    .with_billing(AiUsageBilling::Enabled);

    assert_eq!(
        svc.check_allowance(&payer).await.unwrap(),
        AllowanceDecision::Allow
    );
    svc.settle(&payer).await.unwrap();
    assert!(repo.state.lock().unwrap().consumed.is_empty());
    assert!(repo.charges().is_empty());
    assert!(payments.opened().is_empty());
    assert_eq!(repo.state.lock().unwrap().balance, 10_000);
}

#[tokio::test]
async fn policy_activation_during_analytics_read_cannot_double_bill() {
    struct ActivatingUsage(FakeRepo);
    impl UsageReader for ActivatingUsage {
        async fn usage_cost_cents_by_user(
            &self,
            users: &[MacroUserIdStr<'static>],
            _period: BillingPeriod,
        ) -> Result<Vec<SeatUsage>> {
            self.0.state.lock().unwrap().activated_seats =
                users.iter().map(ToString::to_string).collect();
            Ok(users
                .iter()
                .map(|user| SeatUsage {
                    user: user.clone(),
                    used_cents: 100_000,
                })
                .collect())
        }
    }
    let (svc, repo, payments, _) = premium_service(0);
    repo.state.lock().unwrap().balance = 10_000;
    let svc = BillingServiceImpl::new(
        svc.entitlements,
        ActivatingUsage(repo.clone()),
        repo.clone(),
        payments.clone(),
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);
    svc.settle(&user("payer@x.com")).await.unwrap();
    assert!(repo.state.lock().unwrap().consumed.is_empty());
    assert!(repo.charges().is_empty());
    assert!(payments.opened().is_empty());
}

#[tokio::test]
async fn allows_within_allowance_and_denies_past_it() {
    let (svc, _, _, usage) = premium_service(1_500);
    let payer = user("payer@x.com");
    assert_eq!(
        svc.check_allowance(&payer).await.unwrap(),
        AllowanceDecision::Allow
    );
    *usage.cents.lock().unwrap() = 2_000;
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
async fn disabled_allows_exhausted_allowances_caps_and_failed_payments_regardless_of_settlement() {
    for billing in [AiUsageBilling::Disabled, AiUsageBilling::Enabled] {
        let (svc, repo, _, _) = premium_service_with(billing, 1_000_000);
        let svc = svc.with_enforcement(AiUsageEnforcement::Disabled);
        let payer = user("payer@x.com");
        assert_eq!(
            svc.check_allowance(&payer).await.unwrap(),
            AllowanceDecision::Allow
        );
        assert_eq!(svc.snapshot(&payer).await.unwrap().blocked_reason, None);

        // Changing settings directly keeps this admission test independent of settlement.
        repo.update_overage(&payer, true, 1_000).await.unwrap();
        assert_eq!(svc.snapshot(&payer).await.unwrap().blocked_reason, None);
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
async fn enabled_enforces_allowances_under_either_settlement_policy_without_settling() {
    for billing in [AiUsageBilling::Disabled, AiUsageBilling::Enabled] {
        let (svc, repo, payments, usage) = premium_service_with(billing, 4_000);
        let payer = user("payer@x.com");
        assert_eq!(
            svc.check_allowance(&payer).await.unwrap(),
            AllowanceDecision::Deny(DenyReason::AllowanceExhausted)
        );
        assert_eq!(
            svc.snapshot(&payer).await.unwrap().blocked_reason,
            Some(DenyReason::AllowanceExhausted)
        );
        repo.update_overage(&payer, true, 1_000).await.unwrap();
        *usage.cents.lock().unwrap() = 5_000;
        assert_eq!(
            svc.check_allowance(&payer).await.unwrap(),
            AllowanceDecision::Deny(DenyReason::AllowanceExhausted)
        );
        repo.state.lock().unwrap().auto_reload_suspended = true;
        assert_eq!(
            svc.check_allowance(&payer).await.unwrap(),
            AllowanceDecision::Deny(DenyReason::OveragePaymentFailed)
        );
        assert!(repo.charges().is_empty());
        assert!(repo.state.lock().unwrap().consumed.is_empty());
        assert!(payments.opened().is_empty());
        assert!(payments.payments().is_empty());
    }
}

#[tokio::test]
async fn default_disabled_gate_and_disabled_settlement_do_not_read_entitlements() {
    struct PanicEntitlements;
    impl EntitlementSource for PanicEntitlements {
        async fn entitlement(&self, _: &MacroUserIdStr<'_>) -> Result<Entitlement> {
            panic!("must not read entitlements")
        }
        async fn stripe_customer_id(&self, _: &MacroUserIdStr<'_>) -> Result<Option<String>> {
            panic!("must not resolve a payment customer")
        }
        async fn team_payer(&self, _: Uuid) -> Result<Option<MacroUserIdStr<'static>>> {
            panic!("must not resolve a team payer")
        }
    }
    let svc = BillingServiceImpl::new(
        PanicEntitlements,
        FakeUsage::default(),
        FakeRepo::default(),
        FakePayments::default(),
        AiPricing::testing(),
    );
    assert_eq!(
        svc.check_allowance(&user("payer@x.com")).await.unwrap(),
        AllowanceDecision::Allow
    );
    // Quota enforcement alone never turns settlement on.
    svc.with_enforcement(AiUsageEnforcement::Enabled)
        .settle(&user("payer@x.com"))
        .await
        .unwrap();
}

#[tokio::test]
async fn disabled_settlement_preserves_credits_and_never_reserves_or_collects_overage() {
    let (mut svc, repo, payments, usage, _, payer, previous, current) = anchored_premium(1_000_000);
    svc.billing = AiUsageBilling::Disabled;
    svc.sync_period(&payer, current.start, current.end, None)
        .await
        .unwrap();
    usage.add(
        &payer,
        previous.start + chrono::Duration::days(2),
        1_000_000,
    );

    repo.update_overage(&payer, true, 10_000).await.unwrap();
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

#[tokio::test]
async fn enabled_settlement_does_not_retry_pending_or_failed_direct_charges() {
    for status in [OverageChargeStatus::Pending, OverageChargeStatus::Failed] {
        for invoice in [None, Some("in_existing".to_string())] {
            let (svc, repo, payments, _) = premium_service_with(AiUsageBilling::Enabled, 1_000_000);
            let payer = user("payer@x.com");
            let period = BillingPeriod::current(None, Utc::now());
            repo.state.lock().unwrap().charges.push(FakeCharge {
                id: macro_uuid::generate_uuid_v7(),
                period_start: period.start,
                amount_cents: 1_000,
                status,
                invoice: invoice.clone(),
                hosted_invoice_url: None,
                updated_at: Utc::now(),
            });

            repo.update_overage(&payer, true, 10_000).await.unwrap();
            repo.pause_reloads();
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

#[tokio::test]
async fn free_users_are_hard_capped_at_the_free_allowance() {
    // `FakeUsage::cents` is attributed to the first requested user, which for
    // a free user is the user themself.
    let (svc, repo, _, usage) = premium_service(499);
    let free = user("free@x.com");
    assert_eq!(
        svc.check_allowance(&free).await.unwrap(),
        AllowanceDecision::Allow
    );
    let snap = svc.snapshot(&free).await.unwrap();
    assert_eq!(snap.tier, PlanTier::Free);
    assert_eq!(snap.included_cents, 500);
    assert_eq!(snap.used_cents, 499);
    assert_eq!(snap.remaining_cents, 1);
    assert_eq!(snap.blocked_reason, None);
    // The free period is the calendar month: no Stripe anchor exists.
    let month = BillingPeriod::calendar_month(Utc::now());
    assert_eq!(
        BillingPeriod {
            start: snap.period_start,
            end: snap.period_end
        },
        month
    );
    // Even a live anchor left behind by a lapsed subscription (the fake
    // repo's settings are shared by every payer) does not move it.
    let start = Utc::now() - chrono::Duration::days(3);
    repo.set_period(&free, start, start + chrono::Duration::days(30))
        .await
        .unwrap();
    let snap = svc.snapshot(&free).await.unwrap();
    assert_eq!(
        (snap.period_start, snap.period_end),
        (month.start, month.end)
    );

    *usage.cents.lock().unwrap() = 500;
    assert_eq!(
        svc.check_allowance(&free).await.unwrap(),
        AllowanceDecision::Deny(DenyReason::FreeAllowanceExhausted)
    );
    let snap = svc.snapshot(&free).await.unwrap();
    assert_eq!(snap.remaining_cents, 0);
    assert_eq!(
        snap.blocked_reason,
        Some(DenyReason::FreeAllowanceExhausted)
    );

    // Nothing is ever settled for a free user, and they cannot buy their way out.
    svc.settle(&free).await.unwrap();
    assert_eq!(repo.state.lock().unwrap().balance, 0);
    assert!(matches!(
        svc.update_overage(&free, true, 5_000).await,
        Err(BillingError::FreePlan)
    ));
    assert!(matches!(
        svc.update_auto_reload(&free, true, AutoReloadThresholds::default())
            .await,
        Err(BillingError::FreePlan)
    ));
    assert!(matches!(
        svc.create_credit_checkout(&free, 1_000, String::new(), String::new())
            .await,
        Err(BillingError::FreePlan)
    ));
}

#[tokio::test]
async fn free_users_are_not_gated_while_enforcement_is_off() {
    let (svc, ..) = premium_service_with(AiUsageBilling::Enabled, 1_000_000);
    let svc = svc.with_enforcement(AiUsageEnforcement::Disabled);
    let free = user("free@x.com");
    assert_eq!(
        svc.check_allowance(&free).await.unwrap(),
        AllowanceDecision::Allow
    );
    let snap = svc.snapshot(&free).await.unwrap();
    assert_eq!(snap.used_cents, 1_000_000);
    assert_eq!(snap.remaining_cents, 0);
    assert_eq!(snap.blocked_reason, None);
}

#[tokio::test]
async fn credits_unblock_and_settlement_consumes_them() {
    let (svc, repo, ..) = premium_service(2_600);
    let payer = user("payer@x.com");
    assert!(matches!(
        svc.check_allowance(&payer).await.unwrap(),
        AllowanceDecision::Deny(_)
    ));

    svc.apply_credit_purchase(&payer, 2_500, "cs_1")
        .await
        .unwrap();
    // The purchase settles: 600 cost over is 630 consumed, 1_870 left, which
    // pays for 1_780 more cost cents at the markup.
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.credits_consumed_cents, 630);
    assert_eq!(snap.credit_balance_cents, 1_870);
    assert_eq!(snap.uncovered_cents, 0);
    assert_eq!(snap.remaining_cents, 1_780);
    assert_eq!(
        svc.check_allowance(&payer).await.unwrap(),
        AllowanceDecision::Allow
    );

    // A webhook retry books nothing twice.
    svc.apply_credit_purchase(&payer, 2_500, "cs_1")
        .await
        .unwrap();
    assert_eq!(repo.state.lock().unwrap().balance, 1_870);
}

#[tokio::test]
async fn legacy_overage_opt_in_never_funds_or_charges_usage() {
    let (svc, repo, payments, _) = premium_service(5_000);
    let payer = user("payer@x.com");
    repo.update_overage(&payer, true, 10_000).await.unwrap();
    repo.pause_reloads();
    repo.set_balance(500);
    svc.settle(&payer).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.credits_consumed_cents, 500);
    assert_eq!(snap.credit_balance_cents, 0);
    assert_eq!(snap.uncovered_cents, 2_650);
    assert_eq!(snap.remaining_cents, 0);
    assert_eq!(snap.blocked_reason, Some(DenyReason::OveragePaymentFailed));
    assert!(repo.charges().is_empty());
    assert!(payments.opened().is_empty());
    assert!(payments.payments().is_empty());
}

#[tokio::test]
async fn direct_usage_billing_cannot_be_enabled() {
    let (svc, repo, payments, _) = premium_service(5_000);
    let payer = user("payer@x.com");
    for limit in [100, 5_000, 500_000] {
        assert!(matches!(
            svc.update_overage(&payer, true, limit).await,
            Err(BillingError::DirectUsageBillingDisabled)
        ));
    }
    assert!(!repo.settings(&payer).await.unwrap().overage_enabled);
    assert!(repo.charges().is_empty());
    assert!(payments.payments().is_empty());
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
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

    assert!(matches!(
        svc.update_overage(&member, true, 1_000).await,
        Err(BillingError::NotPayer)
    ));
    assert!(matches!(
        svc.update_auto_reload(&member, true, AutoReloadThresholds::default())
            .await,
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
        Err(BillingError::DirectUsageBillingDisabled)
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
    assert_eq!(snap.included_cents, 2_000);
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
    usage.add(&member, Utc::now(), 3_000);
    let repo = FakeRepo::default();
    let service = BillingServiceImpl::new(
        entitlements,
        usage,
        repo.clone(),
        FakePayments::default(),
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled)
    .with_enforcement(AiUsageEnforcement::Enabled);

    let owner_snapshot = service.snapshot(&owner).await.unwrap();
    assert_eq!(owner_snapshot.used_cents, 0);
    assert_eq!(owner_snapshot.included_cents, 2_000);
    let member_snapshot = service.snapshot(&member).await.unwrap();
    assert_eq!(member_snapshot.used_cents, 3_000);
    assert_eq!(member_snapshot.included_cents, 2_000);
    assert_eq!(
        member_snapshot.blocked_reason,
        Some(DenyReason::AllowanceExhausted)
    );

    service
        .apply_credit_purchase(&owner, 2_500, "cs_team")
        .await
        .unwrap();
    // 1_000 cost over the member's allowance is 1_050 of the shared credits.
    let member_snapshot = service.snapshot(&member).await.unwrap();
    assert_eq!(member_snapshot.credits_consumed_cents, 1_050);
    assert_eq!(member_snapshot.credit_balance_cents, 1_450);
    assert_eq!(member_snapshot.blocked_reason, None);
    assert_eq!(repo.state.lock().unwrap().balance, 1_450);
}

#[tokio::test]
async fn overage_invoice_webhooks_update_suspension() {
    let (svc, repo, _, _) = premium_service(3_500);
    let payer = user("payer@x.com");
    let invoice = "in_legacy".to_string();
    repo.historical_charge(&invoice, 1_575);

    svc.mark_overage_invoice(&invoice, &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap();
    assert!(svc.snapshot(&payer).await.unwrap().overage_suspended);

    // Stripe's own retry collected it.
    svc.mark_overage_invoice(&invoice, &InvoiceOutcome::Paid)
        .await
        .unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(!snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 1_575);

    // Paid is terminal: a late or duplicate failure changes nothing.
    svc.mark_overage_invoice(&invoice, &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(!snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 1_575);
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Paid);

    // Unknown invoices are ignored.
    svc.mark_overage_invoice("in_unknown", &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap();
    assert!(!svc.snapshot(&payer).await.unwrap().overage_suspended);
}

#[tokio::test]
async fn out_of_order_invoice_webhooks_follow_the_newest_charge() {
    let (svc, repo, _, _) = premium_service(5_500);
    let payer = user("payer@x.com");
    let (a, b) = ("in_legacy_a".to_string(), "in_legacy_b".to_string());
    for (invoice, amount) in [(&a, 2_100), (&b, 1_575)] {
        repo.historical_charge(invoice, amount);
    }

    // B fails: suspended.
    svc.mark_overage_invoice(&b, &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap();
    assert!(svc.snapshot(&payer).await.unwrap().overage_suspended);
    // A late `paid` for the older A must not lift B's suspension.
    svc.mark_overage_invoice(&a, &InvoiceOutcome::Paid)
        .await
        .unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 3_675);
    // B eventually collects: cleared, everything covered.
    svc.mark_overage_invoice(&b, &InvoiceOutcome::Paid)
        .await
        .unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(!snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 3_675);

    // The mirror image: a late failure for an older invoice after the newest
    // charge went through does not re-suspend.
    for charge in &mut repo.state.lock().unwrap().charges {
        charge.status = OverageChargeStatus::Pending;
    }
    svc.mark_overage_invoice(&b, &InvoiceOutcome::Paid)
        .await
        .unwrap();
    svc.mark_overage_invoice(&a, &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(!snap.overage_suspended);
    // A remains coverage because its historical invoice can still collect
    // through Stripe, even though settlement never retries direct charges.
    assert_eq!(snap.overage_charged_cents, 3_675);
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Failed);
}

#[tokio::test]
async fn disabled_billing_never_reloads_credits() {
    let (svc, repo, payments, _) = premium_service_with(AiUsageBilling::Disabled, 2_600);
    let payer = user("payer@x.com");
    repo.set_balance(500);

    let snap = svc
        .update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    assert!(snap.overage_enabled);
    assert!(snap.auto_reload.active);
    svc.settle(&payer).await.unwrap();
    svc.snapshot(&payer).await.unwrap();

    assert!(repo.reloads().is_empty());
    assert!(payments.opened_reloads().is_empty());
    assert!(payments.payments().is_empty());
    assert_eq!(repo.state.lock().unwrap().balance, 500);
}

#[tokio::test]
async fn overage_off_never_reloads_credits() {
    let (svc, repo, payments, _) = premium_service(2_600);
    let payer = user("payer@x.com");
    repo.set_balance(500);

    svc.settle(&payer).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();

    assert!(!snap.overage_enabled);
    assert!(!snap.auto_reload.active);
    assert!(!snap.auto_reload.suspended);
    assert!(repo.reloads().is_empty());
    assert!(payments.opened_reloads().is_empty());
    // The 630 owed drains the 500 of credits; the rest stays uncovered.
    assert_eq!(snap.credit_balance_cents, 0);
    assert_eq!(snap.uncovered_cents, 130);
}

#[tokio::test]
async fn a_low_balance_reloads_credits_before_overage_is_reserved() {
    let (svc, repo, payments, _) = premium_service(2_600);
    let payer = user("payer@x.com");
    repo.set_balance(500);

    // 600 cost over is 630 owed: the balance would end at -130, so the
    // reload brings it back to the $100 target after this usage is paid.
    let snap = svc
        .update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    let opened = payments.opened_reloads();
    assert_eq!(opened.len(), 1);
    assert_eq!(opened[0].amount_cents, 10_130);
    assert_eq!(opened[0].customer_id, "cus_123");
    assert_eq!(opened[0].payer, payer);
    assert_eq!(opened[0].scope, SubscriptionScope::Personal);
    assert!(opened[0].description.contains("$101.30"));
    let reloads = repo.reloads();
    assert_eq!(reloads.len(), 1);
    assert_eq!(reloads[0].status, CreditReloadStatus::Paid);
    assert_eq!(
        reloads[0].invoice.as_deref(),
        Some(format!("in_{}", reloads[0].id).as_str())
    );
    assert_eq!(
        payments.payments(),
        vec![(reloads[0].id, format!("in_{}", reloads[0].id))]
    );

    // The reloaded credits covered the usage: no overage chunk was reserved.
    assert_eq!(snap.credits_consumed_cents, 630);
    assert_eq!(snap.credit_balance_cents, 10_000);
    assert_eq!(snap.overage_charged_cents, 0);
    assert_eq!(snap.uncovered_cents, 0);
    assert!(repo.charges().is_empty());
    assert!(payments.opened().is_empty());

    // Back at the target, nothing more is reloaded.
    svc.settle(&payer).await.unwrap();
    assert_eq!(repo.reloads().len(), 1);
}

#[tokio::test]
async fn reload_amount_covers_the_usage_about_to_be_consumed() {
    // 1_904 cost over is exactly 2_000 owed at the 5% markup.
    let (svc, repo, payments, _) = premium_service(3_904);
    let payer = user("payer@x.com");
    repo.set_balance(500);

    let snap = svc
        .update_auto_reload(&payer, true, thresholds(1_000, 10_000, None))
        .await
        .unwrap();

    // 500 on hand less 2_000 owed is -1_500; reaching 10_000 takes 11_500.
    assert_eq!(payments.opened_reloads()[0].amount_cents, 11_500);
    assert_eq!(repo.reloads()[0].amount_cents, 11_500);
    assert_eq!(snap.credits_consumed_cents, 2_000);
    assert_eq!(snap.credit_balance_cents, 10_000);
    assert!(repo.charges().is_empty());
}

#[tokio::test]
async fn monthly_spend_limit_caps_reloads() {
    let (svc, repo, payments, usage) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(500);

    let snap = svc
        .update_auto_reload(&payer, true, thresholds(1_000, 10_000, Some(5_000)))
        .await
        .unwrap();
    assert_eq!(payments.opened_reloads()[0].amount_cents, 5_000);
    assert_eq!(snap.credit_balance_cents, 5_500);
    assert_eq!(snap.auto_reload.monthly_spend_limit_cents, Some(5_000));

    // The month's limit is spent: draining the balance reloads nothing more.
    repo.set_balance(500);
    *usage.cents.lock().unwrap() = 10_000;
    svc.settle(&payer).await.unwrap();
    assert_eq!(repo.reloads().len(), 1);
    assert_eq!(payments.opened_reloads().len(), 1);
    assert_eq!(repo.state.lock().unwrap().balance, 0);
    assert!(repo.charges().is_empty());
    assert!(payments.opened().is_empty());
    assert_eq!(
        svc.check_allowance(&payer).await.unwrap(),
        AllowanceDecision::Deny(DenyReason::AllowanceExhausted)
    );
}

#[tokio::test]
async fn a_declined_reload_stays_pending_for_the_webhook() {
    let (svc, repo, payments, _) = premium_service(3_500);
    let payer = user("payer@x.com");
    repo.set_balance(500);
    payments.set_pay(PayOutcome::Declined);

    let snap = svc
        .update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    // Not suspended: Stripe retries, the webhook decides.
    assert!(snap.auto_reload.active);
    assert!(!snap.auto_reload.suspended);
    assert_eq!(snap.credit_balance_cents, 0);
    assert_eq!(snap.uncovered_cents, 1_075);
    assert_eq!(snap.remaining_cents, 0);
    assert!(repo.charges().is_empty());
    assert!(payments.opened().is_empty());
    let reloads = repo.reloads();
    assert_eq!(reloads.len(), 1);
    assert_eq!(reloads[0].status, CreditReloadStatus::Pending);
    assert!(reloads[0].invoice.is_some());

    // While it is open no second reload is reserved or attempted.
    svc.settle(&payer).await.unwrap();
    assert_eq!(repo.reloads().len(), 1);
    assert_eq!(payments.payments().len(), 1);
}

#[tokio::test]
async fn a_failed_reload_blocks_unfunded_usage_without_a_direct_charge() {
    for fail_open in [false, true] {
        let (svc, repo, payments, _) = premium_service(3_500);
        let payer = user("payer@x.com");
        payments.set_pay(PayOutcome::Error);
        *payments.fail_open.lock().unwrap() = fail_open;
        let snap = svc
            .update_auto_reload(&payer, true, AutoReloadThresholds::default())
            .await
            .unwrap();
        assert_eq!(repo.reloads().len(), 1);
        assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Failed);
        assert!(snap.auto_reload.suspended);
        assert!(!snap.auto_reload.active);
        assert_eq!(snap.uncovered_cents, 1_575);
        assert_eq!(snap.remaining_cents, 0);
        assert_eq!(
            svc.check_allowance(&payer).await.unwrap(),
            AllowanceDecision::Deny(DenyReason::OveragePaymentFailed)
        );
        svc.settle(&payer).await.unwrap();
        assert!(repo.charges().is_empty());
        assert!(payments.opened().is_empty());
        assert_eq!(payments.payments().len(), usize::from(!fail_open));
    }
}

#[tokio::test]
async fn enabling_auto_reload_validates_the_thresholds() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(500);

    for invalid in [
        thresholds(0, 10_000, None),
        thresholds(-1, 10_000, None),
        thresholds(1_000, 1_049, None),
        thresholds(1_000, 500_001, None),
        thresholds(1_000, 10_000, Some(0)),
    ] {
        assert!(
            matches!(
                svc.update_auto_reload(&payer, true, invalid).await,
                Err(BillingError::InvalidAutoReload(_))
            ),
            "{invalid:?} must be rejected"
        );
    }
    let settings = repo.settings(&payer).await.unwrap();
    assert!(!settings.overage_enabled);
    assert_eq!(settings.auto_reload, AutoReloadThresholds::default());
    assert!(repo.reloads().is_empty());
    assert!(payments.opened_reloads().is_empty());

    // Disabling never validates: the stored thresholds are kept as they are.
    svc.update_auto_reload(&payer, false, thresholds(0, 0, Some(0)))
        .await
        .unwrap();
    assert_eq!(
        repo.settings(&payer).await.unwrap().auto_reload,
        AutoReloadThresholds::default()
    );
}

#[tokio::test]
async fn enabling_auto_reload_clears_suspensions_and_settles_without_a_direct_charge_cap() {
    let (svc, repo, _, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(500);
    {
        let mut state = repo.state.lock().unwrap();
        state.suspended = true;
        state.auto_reload_suspended = true;
    }

    // Reloads do not authorize a direct-charge cap, even without a monthly limit.
    let snap = svc
        .update_auto_reload(&payer, true, thresholds(2_000, 20_000, None))
        .await
        .unwrap();
    assert!(snap.overage_enabled);
    assert!(!snap.overage_suspended);
    assert_eq!(snap.auto_reload.minimum_balance_cents, 2_000);
    assert_eq!(snap.auto_reload.target_balance_cents, 20_000);
    assert_eq!(snap.auto_reload.monthly_spend_limit_cents, None);
    assert!(!snap.auto_reload.suspended);
    assert!(snap.auto_reload.active);
    assert_eq!(repo.settings(&payer).await.unwrap().overage_limit_cents, 0);
    // Enabling settled, so the low balance reloaded at once.
    assert_eq!(repo.reloads().len(), 1);
    assert_eq!(repo.reloads()[0].amount_cents, 19_500);
    assert_eq!(snap.credit_balance_cents, 20_000);

    // The monthly limit applies only to reload purchases; keep the offered minimum.
    assert!(matches!(
        svc.update_auto_reload(&payer, true, thresholds(2_000, 20_000, Some(100)))
            .await,
        Err(BillingError::InvalidAutoReload(_))
    ));
    for monthly_limit in [OVERAGE_LIMIT_MIN_CENTS, 25_000, 1_000_000] {
        let snap = svc
            .update_auto_reload(&payer, true, thresholds(2_000, 20_000, Some(monthly_limit)))
            .await
            .unwrap();
        assert_eq!(
            snap.auto_reload.monthly_spend_limit_cents,
            Some(monthly_limit)
        );
        assert_eq!(repo.settings(&payer).await.unwrap().overage_limit_cents, 0);
    }
    assert_eq!(repo.reloads().len(), 1);
}

#[tokio::test]
async fn disabling_auto_reload_turns_overage_off_and_keeps_the_thresholds() {
    let (svc, repo, _, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(10_000);
    let custom = thresholds(2_000, 20_000, Some(30_000));
    svc.update_auto_reload(&payer, true, custom).await.unwrap();

    let snap = svc
        .update_auto_reload(&payer, false, AutoReloadThresholds::default())
        .await
        .unwrap();
    assert!(!snap.overage_enabled);
    assert!(!snap.auto_reload.active);
    assert_eq!(snap.auto_reload.minimum_balance_cents, 2_000);
    assert_eq!(snap.auto_reload.target_balance_cents, 20_000);
    assert_eq!(snap.auto_reload.monthly_spend_limit_cents, Some(30_000));
    let settings = repo.settings(&payer).await.unwrap();
    assert!(!settings.overage_enabled);
    assert_eq!(settings.overage_limit_cents, 0);
    assert_eq!(settings.auto_reload, custom);

    // Off means off: a low balance no longer reloads.
    repo.set_balance(500);
    svc.settle(&payer).await.unwrap();
    assert!(repo.reloads().is_empty());
}

#[tokio::test]
async fn reload_invoice_webhooks_book_credits_once() {
    // Collected synchronously: the webhook finds nothing left to book.
    let (svc, repo, _, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(500);
    svc.update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    let invoice = repo.reloads()[0].invoice.clone().unwrap();
    assert_eq!(repo.state.lock().unwrap().balance, 10_000);
    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::Paid)
        .await
        .unwrap();
    assert_eq!(repo.state.lock().unwrap().balance, 10_000);

    // Declined at first, collected by Stripe's retry: the webhook books it.
    let (svc, repo, payments, _) = premium_service(0);
    repo.set_balance(500);
    payments.set_pay(PayOutcome::Declined);
    svc.update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    let invoice = repo.reloads()[0].invoice.clone().unwrap();
    assert_eq!(repo.state.lock().unwrap().balance, 500);
    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::Paid)
        .await
        .unwrap();
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Paid);
    assert_eq!(repo.state.lock().unwrap().balance, 10_000);

    // Paid is terminal: a duplicate or a late failure changes nothing.
    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::Paid)
        .await
        .unwrap();
    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap();
    assert_eq!(repo.state.lock().unwrap().balance, 10_000);
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Paid);
    assert!(!svc.snapshot(&payer).await.unwrap().auto_reload.suspended);

    // Unknown invoices are ignored.
    svc.mark_credit_reload_invoice("in_unknown", &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap();
    assert!(!svc.snapshot(&payer).await.unwrap().auto_reload.suspended);
}

#[tokio::test]
async fn a_failed_reload_invoice_webhook_pauses_reloads_only() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(500);
    payments.set_pay(PayOutcome::Declined);
    svc.update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    let invoice = repo.reloads()[0].invoice.clone().unwrap();

    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap();
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Failed);
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(snap.auto_reload.suspended);
    assert!(!snap.auto_reload.active);
    // Overage itself is untouched by a reload failure.
    assert!(snap.overage_enabled);
    assert!(!snap.overage_suspended);

    // Paused: the low balance does not reload again.
    payments.set_pay(PayOutcome::Paid);
    svc.settle(&payer).await.unwrap();
    assert_eq!(repo.reloads().len(), 1);
    assert_eq!(repo.state.lock().unwrap().balance, 500);
}

#[tokio::test]
async fn a_reload_needing_authentication_pauses_reloads_and_reports_the_page() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(500);
    payments.set_pay(PayOutcome::ActionRequired);

    let snap = svc
        .update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    let reloads = repo.reloads();
    assert_eq!(reloads.len(), 1);
    assert_eq!(reloads[0].status, CreditReloadStatus::RequiresAction);
    assert_eq!(
        reloads[0].hosted_invoice_url.as_deref(),
        Some(HOSTED_INVOICE_URL)
    );
    // Not a decline, but nothing happens until the payer acts: paused like one.
    assert!(snap.auto_reload.suspended);
    assert!(!snap.auto_reload.active);
    assert_eq!(snap.credit_balance_cents, 500);
    // Overage itself is untouched by a reload awaiting authentication.
    assert!(snap.overage_enabled);
    assert!(!snap.overage_suspended);
    assert_eq!(
        snap.payment_action,
        Some(PaymentAction {
            kind: PaymentActionKind::CreditReload,
            amount_cents: 9_500,
            hosted_invoice_url: Some(HOSTED_INVOICE_URL.to_string()),
        })
    );

    // Paused: no second reload is reserved and the invoice is not retried.
    svc.settle(&payer).await.unwrap();
    assert_eq!(repo.reloads().len(), 1);
    assert_eq!(payments.payments().len(), 1);

    // The payer authenticates on the hosted page: the webhook books the
    // credits and reloads resume.
    let invoice = reloads[0].invoice.clone().unwrap();
    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::Paid)
        .await
        .unwrap();
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Paid);
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.credit_balance_cents, 10_000);
    assert!(!snap.auto_reload.suspended);
    assert!(snap.auto_reload.active);
    assert_eq!(snap.payment_action, None);
}

#[tokio::test]
async fn re_enabling_retries_an_authentication_pending_reload_with_the_current_card() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(500);
    payments.set_pay(PayOutcome::ActionRequired);
    svc.update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    let reserved = repo.reloads()[0].clone();
    assert_eq!(reserved.status, CreditReloadStatus::RequiresAction);

    // The payer puts a working card on file and saves again: the same reload
    // and invoice are retried rather than a second one opened.
    payments.set_pay(PayOutcome::Paid);
    let snap = svc
        .update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    let reloads = repo.reloads();
    assert_eq!(reloads.len(), 1);
    assert_eq!(reloads[0].id, reserved.id);
    assert_eq!(reloads[0].status, CreditReloadStatus::Paid);
    assert_eq!(payments.opened_reloads().len(), 1);
    assert_eq!(
        payments.payments(),
        vec![
            (reserved.id, reserved.invoice.clone().unwrap()),
            (reserved.id, reserved.invoice.clone().unwrap()),
        ]
    );
    assert_eq!(snap.credit_balance_cents, 10_000);
    assert!(snap.auto_reload.active);
    assert_eq!(snap.payment_action, None);
}

#[tokio::test]
async fn an_overage_charge_needing_authentication_pauses_overage_and_reports_the_page() {
    let (svc, repo, payments, _) = premium_service(3_500);
    let payer = user("payer@x.com");
    let invoice = "in_legacy_auth";
    repo.historical_charge(invoice, 1_575);
    svc.mark_overage_invoice(
        invoice,
        &InvoiceOutcome::ActionRequired {
            hosted_invoice_url: Some(HOSTED_INVOICE_URL.to_string()),
        },
    )
    .await
    .unwrap();

    let snap = svc.snapshot(&payer).await.unwrap();
    let charges = repo.charges();
    assert_eq!(charges.len(), 1);
    assert_eq!(charges[0].amount_cents, 1_575);
    assert_eq!(charges[0].status, OverageChargeStatus::RequiresAction);
    assert_eq!(
        charges[0].hosted_invoice_url.as_deref(),
        Some(HOSTED_INVOICE_URL)
    );
    assert!(snap.overage_suspended);
    // The chunk keeps covering its usage while Stripe can still collect it.
    assert_eq!(snap.overage_charged_cents, 1_575);
    assert_eq!(snap.uncovered_cents, 0);
    assert_eq!(snap.blocked_reason, Some(DenyReason::AllowanceExhausted));
    assert_eq!(
        snap.payment_action,
        Some(PaymentAction {
            kind: PaymentActionKind::OverageCharge,
            amount_cents: 1_575,
            hosted_invoice_url: Some(HOSTED_INVOICE_URL.to_string()),
        })
    );

    // Suspended: nothing more is reserved or attempted.
    svc.settle(&payer).await.unwrap();
    assert_eq!(repo.charges().len(), 1);
    assert!(payments.payments().is_empty());

    // Authenticated: the webhook lifts the suspension.
    let invoice = charges[0].invoice.clone().unwrap();
    svc.mark_overage_invoice(&invoice, &InvoiceOutcome::Paid)
        .await
        .unwrap();
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Paid);
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(!snap.overage_suspended);
    // Paying historical usage does not provide headroom for new requests.
    assert_eq!(snap.blocked_reason, Some(DenyReason::AllowanceExhausted));
    assert_eq!(snap.payment_action, None);
}

#[tokio::test]
async fn a_voided_reload_invoice_stops_blocking_and_counting() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(500);
    payments.set_pay(PayOutcome::Declined);
    let capped = thresholds(1_000, 10_000, Some(12_000));
    svc.update_auto_reload(&payer, true, capped).await.unwrap();
    let first = repo.reloads()[0].clone();
    assert_eq!(first.status, CreditReloadStatus::Pending);
    let invoice = first.invoice.clone().unwrap();

    // Stripe gave up on it: reloads pause until the payer acts.
    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::Voided)
        .await
        .unwrap();
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Voided);
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(snap.auto_reload.suspended);
    assert_eq!(snap.payment_action, None);
    // A void is final: a late decline or payment report changes nothing.
    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap();
    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::Paid)
        .await
        .unwrap();
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Voided);
    assert_eq!(repo.state.lock().unwrap().balance, 500);

    // Saving again reserves a fresh reload: the voided one neither blocks,
    // is retried, nor counts against the month (9_500 would otherwise leave
    // only 2_500 under the cap).
    payments.set_pay(PayOutcome::Paid);
    let snap = svc.update_auto_reload(&payer, true, capped).await.unwrap();
    let reloads = repo.reloads();
    assert_eq!(reloads.len(), 2);
    assert_eq!(reloads[1].status, CreditReloadStatus::Paid);
    assert_eq!(reloads[1].amount_cents, 9_500);
    assert_eq!(payments.opened_reloads().len(), 2);
    assert_eq!(snap.credit_balance_cents, 10_000);
    assert!(snap.auto_reload.active);
}

#[tokio::test]
async fn a_voided_overage_invoice_uncovers_its_usage_and_pauses_overage() {
    let (svc, repo, payments, _) = premium_service(3_500);
    let payer = user("payer@x.com");
    let invoice = "in_legacy_void";
    repo.historical_charge(invoice, 1_575);
    assert_eq!(
        svc.snapshot(&payer).await.unwrap().overage_charged_cents,
        1_575
    );

    svc.mark_overage_invoice(&invoice, &InvoiceOutcome::Voided)
        .await
        .unwrap();
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Voided);
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 0);
    assert_eq!(snap.uncovered_cents, 1_575);

    // Settlement cannot replace or retry the direct charge. Prepaid credits
    // cover the newly uncovered usage instead.
    svc.settle(&payer).await.unwrap();
    svc.apply_credit_purchase(&payer, 2_500, "cs_after_void")
        .await
        .unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(repo.charges().len(), 1);
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Voided);
    assert!(payments.opened().is_empty());
    assert!(payments.payments().is_empty());
    assert_eq!(snap.overage_charged_cents, 0);
    assert_eq!(snap.credits_consumed_cents, 1_575);
    assert_eq!(snap.credit_balance_cents, 925);
    assert_eq!(snap.uncovered_cents, 0);
}

#[tokio::test]
async fn a_written_off_invoice_only_moves_to_paid_or_voided() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(500);
    payments.set_pay(PayOutcome::Declined);
    svc.update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    let invoice = repo.reloads()[0].invoice.clone().unwrap();

    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::Uncollectible)
        .await
        .unwrap();
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Uncollectible);
    assert!(svc.snapshot(&payer).await.unwrap().auto_reload.suspended);

    // A late decline or authentication request cannot revive a write-off...
    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::PaymentFailed)
        .await
        .unwrap();
    svc.mark_credit_reload_invoice(
        &invoice,
        &InvoiceOutcome::ActionRequired {
            hosted_invoice_url: Some(HOSTED_INVOICE_URL.to_string()),
        },
    )
    .await
    .unwrap();
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Uncollectible);
    assert_eq!(svc.snapshot(&payer).await.unwrap().payment_action, None);

    // ...but a late payment still books the credits and resumes reloads.
    svc.mark_credit_reload_invoice(&invoice, &InvoiceOutcome::Paid)
        .await
        .unwrap();
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Paid);
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.credit_balance_cents, 10_000);
    assert!(!snap.auto_reload.suspended);
}

#[tokio::test]
async fn the_collector_closes_an_invoice_stripe_already_voided() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(500);
    payments.set_pay(PayOutcome::Error);
    svc.update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    let failed = repo.reloads()[0].clone();
    assert_eq!(failed.status, CreditReloadStatus::Failed);
    assert!(failed.invoice.is_some());

    // Stripe voided the invoice meanwhile (its void webhook was lost). The
    // retry on re-save finds that out and closes the row instead of failing
    // on the same dead invoice every time the payer saves.
    payments.set_pay(PayOutcome::Voided);
    let snap = svc
        .update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    assert_eq!(repo.reloads().len(), 1);
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Voided);
    assert!(snap.auto_reload.suspended);

    payments.set_pay(PayOutcome::Paid);
    let snap = svc
        .update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    let reloads = repo.reloads();
    assert_eq!(reloads.len(), 2);
    assert_eq!(reloads[1].status, CreditReloadStatus::Paid);
    assert_eq!(snap.credit_balance_cents, 10_000);
}

/// A service over the same fakes with no memory of recent reconciliations,
/// as another process (or this one after the backoff) would be.
fn fresh(svc: &Service) -> Service {
    Service {
        reconciled: Arc::default(),
        ..svc.clone()
    }
}

#[tokio::test]
async fn stale_invoices_are_read_back_from_the_provider() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(500);
    payments.set_pay(PayOutcome::Declined);
    svc.update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    let invoice = repo.reloads()[0].invoice.clone().unwrap();
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Pending);

    // A fresh row is left to the webhook.
    fresh(&svc).settle(&payer).await.unwrap();
    assert!(payments.invoice_reads().is_empty());

    // An hour on with no webhook, the provider says the payment is waiting
    // on the customer: the row and the summary learn that here.
    repo.age_invoices(chrono::Duration::hours(2));
    payments.set_invoice_outcome(
        &invoice,
        InvoiceOutcome::ActionRequired {
            hosted_invoice_url: Some(HOSTED_INVOICE_URL.to_string()),
        },
    );
    fresh(&svc).settle(&payer).await.unwrap();
    assert_eq!(payments.invoice_reads(), vec![invoice.clone()]);
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::RequiresAction);
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(snap.auto_reload.suspended);
    assert_eq!(
        snap.payment_action
            .as_ref()
            .and_then(|action| action.hosted_invoice_url.as_deref()),
        Some(HOSTED_INVOICE_URL)
    );

    // The row just moved, so it is not stale again for another hour; and
    // within the backoff this process does not even look.
    svc.settle(&payer).await.unwrap();
    fresh(&svc).settle(&payer).await.unwrap();
    assert_eq!(payments.invoice_reads().len(), 1);

    // The customer paid on the hosted page but that webhook was lost too:
    // reconciliation books the credits and resumes reloads, and the
    // settlement that follows runs on the new balance.
    repo.age_invoices(chrono::Duration::hours(2));
    payments.set_invoice_outcome(&invoice, InvoiceOutcome::Paid);
    fresh(&svc).settle(&payer).await.unwrap();
    assert_eq!(payments.invoice_reads().len(), 2);
    assert_eq!(repo.reloads().len(), 1);
    assert_eq!(repo.reloads()[0].status, CreditReloadStatus::Paid);
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.credit_balance_cents, 10_000);
    assert!(!snap.auto_reload.suspended);
    assert_eq!(snap.payment_action, None);

    // Final rows are never read again.
    repo.age_invoices(chrono::Duration::hours(2));
    fresh(&svc).settle(&payer).await.unwrap();
    assert_eq!(payments.invoice_reads().len(), 2);
}

#[tokio::test]
async fn reconciliation_closes_a_charge_the_provider_voided_and_leaves_inconclusive_ones() {
    let (svc, repo, payments, _) = premium_service(3_500);
    let payer = user("payer@x.com");
    let invoice = "in_legacy_stale".to_string();
    repo.historical_charge(&invoice, 1_575);
    repo.age_invoices(chrono::Duration::hours(2));

    // Nothing conclusive at the provider yet: the row stays as it is and
    // keeps covering its usage.
    fresh(&svc).settle(&payer).await.unwrap();
    assert_eq!(payments.invoice_reads(), vec![invoice.clone()]);
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Pending);
    assert_eq!(repo.charges().len(), 1);

    // Voided: it stops covering the usage. Settlement cannot replace or
    // retry historical direct charges.
    payments.set_invoice_outcome(&invoice, InvoiceOutcome::Voided);
    fresh(&svc).settle(&payer).await.unwrap();
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Voided);
    assert_eq!(repo.charges().len(), 1);
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(snap.overage_suspended);
    assert_eq!(snap.overage_charged_cents, 0);
    assert_eq!(snap.uncovered_cents, 1_575);
}

#[tokio::test]
async fn disabled_settlement_never_reconciles_invoices() {
    let (svc, repo, payments, _) = premium_service_with(AiUsageBilling::Disabled, 3_500);
    let payer = user("payer@x.com");
    let period = BillingPeriod::current(None, Utc::now());
    repo.state.lock().unwrap().charges.push(FakeCharge {
        id: macro_uuid::generate_uuid_v7(),
        period_start: period.start,
        amount_cents: 1_000,
        status: OverageChargeStatus::Pending,
        invoice: Some("in_stuck".to_string()),
        hosted_invoice_url: None,
        updated_at: Utc::now() - chrono::Duration::days(3),
    });
    payments.set_invoice_outcome("in_stuck", InvoiceOutcome::Voided);

    svc.settle(&payer).await.unwrap();
    assert!(payments.invoice_reads().is_empty());
    assert_eq!(repo.charges()[0].status, OverageChargeStatus::Pending);
}

#[tokio::test]
async fn snapshot_reports_whether_automatic_reload_is_active() {
    let (svc, repo, _, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_balance(10_000);

    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(!snap.auto_reload.active);
    assert!(!snap.auto_reload.suspended);

    let snap = svc
        .update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();
    assert!(snap.auto_reload.active);

    // Historical overage suspensions do not stop automatic reloads.
    repo.suspend_overage(&payer).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert!(snap.overage_suspended);
    assert!(!snap.auto_reload.suspended);
    assert!(snap.auto_reload.active);

    svc.update_auto_reload(&payer, false, AutoReloadThresholds::default())
        .await
        .unwrap();
    assert!(!svc.snapshot(&payer).await.unwrap().auto_reload.active);
}

#[tokio::test]
async fn synced_period_anchors_the_snapshot() {
    let (svc, ..) = premium_service(0);
    let payer = user("payer@x.com");
    let start = Utc::now() - chrono::Duration::days(3);
    let end = start + chrono::Duration::days(30);
    svc.sync_period(&payer, start, end, None).await.unwrap();
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.period_start, start);
    assert_eq!(snap.period_end, end);
    for corrected in [
        end + chrono::Duration::days(2),
        end - chrono::Duration::days(2),
    ] {
        svc.sync_period(&payer, start, corrected, None)
            .await
            .unwrap();
        let snapshot = svc.snapshot(&payer).await.unwrap();
        assert_eq!(
            (snapshot.period_start, snapshot.period_end),
            (start, corrected)
        );
    }
    // Inverted periods are ignored.
    svc.sync_period(&payer, end, start, None).await.unwrap();
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
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);
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
    svc.sync_period(&payer, current.start, current.end, None)
        .await
        .unwrap();
    svc.snapshot(&payer).await.unwrap();
    let frozen = repo.allowance(current.start).expect("open period frozen");
    assert_eq!(
        frozen.seats,
        vec![SeatAllowance {
            user: payer.clone(),
            included_cents: 2_000,
        }]
    );

    // A roster change while the period is open refreshes the freeze.
    let member = user("member@x.com");
    ents.set(Entitlement {
        tier: PlanTier::Premium,
        seat_tiers: vec![PlanTier::Premium, PlanTier::Premium],
        unlimited: false,
        payer: payer.clone(),
        billed_users: vec![payer.clone(), member.clone()],
        scope: PayerScope::TeamOwner {
            team_id: macro_uuid::generate_uuid_v7(),
        },
    });
    svc.snapshot(&payer).await.unwrap();
    let frozen = repo
        .allowance(current.start)
        .expect("open period refreshed");
    assert_eq!(
        frozen.seats,
        vec![
            SeatAllowance {
                user: payer.clone(),
                included_cents: 2_000,
            },
            SeatAllowance {
                user: member,
                included_cents: 2_000,
            },
        ]
    );
}

#[tokio::test]
async fn previous_period_credits_use_the_frozen_allowance_not_the_live_one() {
    let (svc, repo, payments, usage, _, payer, previous, current) = anchored_premium(0);
    repo.pause_reloads();
    repo.set_balance(10_000);
    svc.sync_period(&payer, current.start, current.end, None)
        .await
        .unwrap();
    // A smaller allowance was in force while the previous period was open.
    repo.freeze(
        previous.start,
        PeriodAllowance {
            seats: vec![SeatAllowance {
                user: payer.clone(),
                included_cents: 1_000,
            }],
        },
    );
    repo.update_overage(&payer, true, 10_000).await.unwrap();
    usage.add(&payer, previous.start + chrono::Duration::days(2), 2_500);

    svc.settle(&payer).await.unwrap();

    // 2_500 cost against the frozen 1_000: 1_500 over, 1_575 prepaid credits.
    assert_eq!(repo.state.lock().unwrap().consumed[&previous.start], 1_575);
    assert!(payments.opened().is_empty());
    assert!(repo.charges().is_empty());
    // The closed period keeps its freeze; the open one reflects the live allowance.
    assert_eq!(
        repo.allowance(previous.start).unwrap().seats[0].included_cents,
        1_000
    );
    assert_eq!(
        repo.allowance(current.start).unwrap().seats[0].included_cents,
        2_000
    );
}

#[tokio::test]
async fn previous_period_does_not_charge_usage_its_frozen_allowance_included() {
    let (svc, repo, payments, usage, _, payer, previous, current) = anchored_premium(0);
    repo.pause_reloads();
    svc.sync_period(&payer, current.start, current.end, None)
        .await
        .unwrap();
    // A larger allowance was in force while the previous period was open.
    repo.freeze(
        previous.start,
        PeriodAllowance {
            seats: vec![SeatAllowance {
                user: payer.clone(),
                included_cents: 5_000,
            }],
        },
    );
    repo.update_overage(&payer, true, 10_000).await.unwrap();
    // Over the live 2_000, but inside the frozen 5_000.
    usage.add(&payer, previous.start + chrono::Duration::days(2), 4_000);

    svc.settle(&payer).await.unwrap();

    assert!(payments.opened().is_empty());
    assert!(repo.charges().is_empty());
}

#[tokio::test]
async fn previous_period_usage_never_triggers_a_reload() {
    let (svc, repo, payments, usage, _, payer, previous, current) = anchored_premium(0);
    svc.sync_period(&payer, current.start, current.end, None)
        .await
        .unwrap();
    // 2_000 cost over the closed period's allowance is 2_100 owed, with no
    // credits on hand.
    usage.add(&payer, previous.start + chrono::Duration::days(2), 4_000);

    svc.update_auto_reload(&payer, true, AutoReloadThresholds::default())
        .await
        .unwrap();

    // Unfunded closed-period usage stays uncovered; only the open period reloads.
    assert!(payments.opened().is_empty());
    assert!(repo.charges().is_empty());
    let reloads = repo.reloads();
    assert_eq!(reloads.len(), 1);
    assert_eq!(reloads[0].amount_cents, 10_000);
    assert_eq!(repo.state.lock().unwrap().balance, 10_000);
}

fn one_seat(payer: &MacroUserIdStr<'static>, included_cents: i64) -> PeriodAllowance {
    PeriodAllowance {
        seats: vec![SeatAllowance {
            user: payer.clone(),
            included_cents,
        }],
    }
}

/// Credits consumed per period start, oldest first.
fn consumed_by_period(repo: &FakeRepo) -> Vec<(DateTime<Utc>, i64)> {
    let mut consumed: Vec<(DateTime<Utc>, i64)> = repo
        .state
        .lock()
        .unwrap()
        .consumed
        .iter()
        .filter(|(_, cents)| **cents > 0)
        .map(|(start, cents)| (*start, *cents))
        .collect();
    consumed.sort_unstable();
    consumed
}

#[tokio::test]
async fn older_frozen_periods_are_settled_inside_the_reconciliation_window() {
    let (svc, repo, payments, usage, _, payer, previous, current) = anchored_premium(0);
    repo.pause_reloads();
    repo.set_balance(10_000);
    svc.sync_period(&payer, current.start, current.end, None)
        .await
        .unwrap();
    // Three closed periods behind the previous one, each observed while open
    // and each run 1_500 past its frozen allowance; nothing settled them.
    let two_back = previous.previous();
    let three_back = two_back.previous();
    let four_back = three_back.previous();
    for period in [two_back, three_back, four_back] {
        repo.freeze(period.start, one_seat(&payer, 1_000));
        usage.add(&payer, period.start + chrono::Duration::days(2), 2_500);
    }

    svc.settle(&payer).await.unwrap();

    // The two inside the window are booked from credits against their own
    // freeze; the one beyond it is left alone rather than settled from a
    // guessed period.
    assert_eq!(
        consumed_by_period(&repo),
        vec![(three_back.start, 1_575), (two_back.start, 1_575)]
    );
    assert_eq!(repo.state.lock().unwrap().balance, 10_000 - 2 * 1_575);
    assert!(payments.opened().is_empty());

    // Settling again books nothing more.
    svc.settle(&payer).await.unwrap();
    assert_eq!(repo.state.lock().unwrap().balance, 10_000 - 2 * 1_575);
}

#[tokio::test]
async fn an_older_frozen_period_ends_where_the_unfrozen_previous_one_begins() {
    let (svc, repo, _, usage, _, payer, previous, current) = anchored_premium(0);
    repo.pause_reloads();
    repo.set_balance(10_000);
    svc.sync_period(&payer, current.start, current.end, None)
        .await
        .unwrap();
    // The period before the previous one was frozen and ran 1_500 over; the
    // previous one was never observed but still carries 200 of usage over
    // the live allowance.
    let two_back = previous.previous();
    repo.freeze(two_back.start, one_seat(&payer, 1_000));
    usage.add(&payer, two_back.start + chrono::Duration::days(2), 2_500);
    usage.add(&payer, previous.start + chrono::Duration::days(2), 2_200);

    svc.settle(&payer).await.unwrap();

    // Each period's usage is booked once, under its own key: the frozen
    // period stops where the derived previous period starts rather than
    // swallowing (and double billing) the usage after it.
    assert_eq!(
        consumed_by_period(&repo),
        vec![(two_back.start, 1_575), (previous.start, 210)]
    );
}

#[tokio::test]
async fn a_period_frozen_inside_the_previous_window_replaces_the_derived_one() {
    let (svc, repo, _, usage, _, payer, previous, current) = anchored_premium(0);
    repo.pause_reloads();
    repo.set_balance(10_000);
    svc.sync_period(&payer, current.start, current.end, None)
        .await
        .unwrap();
    // The subscription was re-anchored mid-cycle: the period that actually
    // preceded the open one started ten days after the derived previous
    // period would have, and was frozen under that start.
    let shifted = previous.start + chrono::Duration::days(10);
    repo.freeze(shifted, one_seat(&payer, 1_000));
    usage.add(&payer, shifted + chrono::Duration::days(2), 2_500);

    svc.settle(&payer).await.unwrap();

    // Booked once, under the frozen start and its 1_000 allowance: a second
    // settlement under the derived start (live 2_000 allowance, 525 owed)
    // would have consumed credits for the same usage twice.
    assert_eq!(consumed_by_period(&repo), vec![(shifted, 1_575)]);
    assert_eq!(repo.state.lock().unwrap().balance, 10_000 - 1_575);
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
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);
    let current_start = Utc::now() - chrono::Duration::days(3);
    let current_end = current_start + chrono::Duration::days(30);
    let current = BillingPeriod {
        start: current_start,
        end: current_end,
    };
    let previous = current.previous();
    svc.sync_period(&owner, current.start, current.end, None)
        .await
        .unwrap();
    repo.freeze(
        previous.start,
        PeriodAllowance {
            seats: vec![
                SeatAllowance {
                    user: owner.clone(),
                    included_cents: 2_000,
                },
                SeatAllowance {
                    user: member_a.clone(),
                    included_cents: 2_000,
                },
            ],
        },
    );
    usage.add(&member_a, previous.start + chrono::Duration::days(2), 7_200);
    usage.add(
        &member_b,
        previous.start + chrono::Duration::days(2),
        50_000,
    );
    ents.set(new_team);
    repo.pause_reloads();
    repo.set_balance(10_000);
    repo.update_overage(&owner, true, 10_000).await.unwrap();
    svc.settle(&owner).await.unwrap();

    assert!(payments.opened().is_empty());
    assert!(repo.charges().is_empty());
    // Member A gets only their own $20 at-cost allowance, so 5_200 cost is
    // chargeable: 5_460 at the markup. The owner's unused allowance does not
    // offset it. Member B's usage is ignored because they were not a billed
    // user in that period.
    assert_eq!(repo.state.lock().unwrap().consumed[&previous.start], 5_460);
}

#[tokio::test]
async fn current_period_uses_the_live_allowance_not_a_stale_freeze() {
    let (svc, repo, payments, usage, _, payer, _, current) = anchored_premium(0);
    repo.pause_reloads();
    svc.sync_period(&payer, current.start, current.end, None)
        .await
        .unwrap();
    // A stale freeze of the open period with a smaller allowance.
    repo.freeze(
        current.start,
        PeriodAllowance {
            seats: vec![SeatAllowance {
                user: payer.clone(),
                included_cents: 1_000,
            }],
        },
    );
    repo.update_overage(&payer, true, 10_000).await.unwrap();
    // Current-period usage over the stale 1_000 but inside the live 2_000.
    *usage.cents.lock().unwrap() = 1_500;
    svc.settle(&payer).await.unwrap();
    assert!(payments.opened().is_empty());
    let snap = svc.snapshot(&payer).await.unwrap();
    assert_eq!(snap.included_cents, 2_000);
    assert_eq!(snap.used_cents, 1_500);
    assert_eq!(snap.uncovered_cents, 0);
    // The open period was re-frozen from the live entitlement.
    assert_eq!(
        repo.allowance(current.start).unwrap().seats[0].included_cents,
        2_000
    );
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
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

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
                included_cents: 2_000,
            }],
        },
    );
    let svc = BillingServiceImpl::new(
        FakeEntitlements::default(),
        FakeUsage::default(),
        repo.clone(),
        FakePayments::default(),
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

    svc.release(Uuid::from_u128(8), &member).await.unwrap();

    assert!(repo.releases().is_empty());
    assert_eq!(
        repo.allowance(period_start).unwrap().seats,
        vec![SeatAllowance {
            user: member,
            included_cents: 2_000,
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
                included_cents: 2_000,
            }],
        },
    );
    let ents = FakeEntitlements::default().payer_for_team(team_id, owner.clone());
    let svc = BillingServiceImpl::new(
        ents,
        FakeUsage::default(),
        repo.clone(),
        FakePayments::default(),
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

    svc.release(team_id, &owner).await.unwrap();

    assert!(repo.releases().is_empty());
    assert_eq!(
        repo.allowance(open.start()).unwrap().seats,
        vec![SeatAllowance {
            user: owner,
            included_cents: 2_000,
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
    // The same seat/allowance pairs as the live entitlement, in another order.
    let stored = vec![
        SeatAllowance {
            user: member.clone(),
            included_cents: 10_000,
        },
        SeatAllowance {
            user: owner.clone(),
            included_cents: 2_000,
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
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

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
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

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

fn d(year: i32, month: u32, day: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(year, month, day, 0, 0, 0).unwrap()
}

fn apr_18_noon() -> DateTime<Utc> {
    d(2026, 4, 18) + chrono::Duration::hours(12)
}

fn premium_team(
    owner: &MacroUserIdStr<'static>,
    member: &MacroUserIdStr<'static>,
    team_id: Uuid,
) -> Entitlement {
    Entitlement {
        tier: PlanTier::Premium,
        seat_tiers: vec![PlanTier::Premium, PlanTier::Premium],
        unlimited: false,
        payer: owner.clone(),
        billed_users: vec![owner.clone(), member.clone()],
        scope: PayerScope::TeamOwner { team_id },
    }
}

#[tokio::test]
async fn missing_anchor_reads_the_subscription_period_once_and_stores_it() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    payments.set_period(PeriodReply::Found(BillingPeriod {
        start: d(2026, 4, 10),
        end: d(2026, 5, 10),
    }));

    let position = svc.position(&payer, apr_18_noon()).await.unwrap();

    assert_eq!(
        position.period,
        BillingPeriod {
            start: d(2026, 4, 10),
            end: d(2026, 5, 10),
        }
    );
    assert_eq!(
        repo.settings(&payer).await.unwrap().period_anchor,
        Some((d(2026, 4, 10), d(2026, 5, 10)))
    );
    assert_eq!(
        payments.period_requests(),
        vec![("cus_123".to_string(), SubscriptionScope::Personal)]
    );

    let position = svc.position(&payer, apr_18_noon()).await.unwrap();
    assert_eq!(position.period.start, d(2026, 4, 10));
    assert_eq!(
        payments.period_requests(),
        vec![("cus_123".to_string(), SubscriptionScope::Personal)],
        "the stored anchor answers the second read"
    );
}

#[tokio::test]
async fn ended_anchor_is_refreshed_from_the_subscription_before_rolling_forward() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_period(&payer, d(2026, 1, 15), d(2026, 2, 15))
        .await
        .unwrap();
    payments.set_period(PeriodReply::Found(BillingPeriod {
        start: d(2026, 4, 10),
        end: d(2026, 5, 10),
    }));

    let position = svc.position(&payer, apr_18_noon()).await.unwrap();

    assert_eq!(
        position.period,
        BillingPeriod {
            start: d(2026, 4, 10),
            end: d(2026, 5, 10),
        },
        "the subscription window, not the anchor rolled to Apr 15"
    );
    assert_eq!(
        repo.settings(&payer).await.unwrap().period_anchor,
        Some((d(2026, 4, 10), d(2026, 5, 10)))
    );
}

#[tokio::test]
async fn overlapping_subscription_window_starts_at_the_stored_end() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_period(&payer, d(2026, 1, 15), d(2026, 2, 15))
        .await
        .unwrap();
    payments.set_period(PeriodReply::Found(BillingPeriod {
        start: d(2026, 2, 3),
        end: d(2026, 3, 3),
    }));

    let position = svc
        .position(&payer, d(2026, 2, 20) + chrono::Duration::hours(12))
        .await
        .unwrap();

    assert_eq!(
        position.period,
        BillingPeriod {
            start: d(2026, 2, 15),
            end: d(2026, 3, 3),
        }
    );
    assert_eq!(
        repo.period_writes(),
        vec![
            (
                "macro|payer@x.com".to_string(),
                d(2026, 1, 15),
                d(2026, 2, 15)
            ),
            (
                "macro|payer@x.com".to_string(),
                d(2026, 2, 15),
                d(2026, 3, 3)
            ),
        ]
    );
    assert_eq!(
        repo.settings(&payer).await.unwrap().period_anchor,
        Some((d(2026, 2, 15), d(2026, 3, 3)))
    );

    svc.position(&payer, d(2026, 2, 21)).await.unwrap();
    assert_eq!(
        payments.period_requests(),
        vec![("cus_123".to_string(), SubscriptionScope::Personal)],
        "the stored window answers the second read"
    );
}

#[tokio::test]
async fn unrolled_subscription_window_rolls_the_anchor_and_stores_nothing() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_period(&payer, d(2026, 3, 18), d(2026, 4, 18))
        .await
        .unwrap();
    payments.set_period(PeriodReply::Found(BillingPeriod {
        start: d(2026, 3, 18),
        end: d(2026, 4, 18),
    }));

    let position = svc
        .position(&payer, d(2026, 4, 18) + chrono::Duration::minutes(30))
        .await
        .unwrap();

    assert_eq!(
        position.period,
        BillingPeriod {
            start: d(2026, 4, 18),
            end: d(2026, 5, 18),
        }
    );
    assert_eq!(
        repo.period_writes(),
        vec![(
            "macro|payer@x.com".to_string(),
            d(2026, 3, 18),
            d(2026, 4, 18)
        )],
        "only the seeded anchor was written"
    );
    assert_eq!(
        repo.settings(&payer).await.unwrap().period_anchor,
        Some((d(2026, 3, 18), d(2026, 4, 18)))
    );
}

#[tokio::test]
async fn subscription_window_after_now_keeps_the_calendar_month_and_stores_nothing() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    payments.set_period(PeriodReply::Found(BillingPeriod {
        start: d(2026, 4, 19),
        end: d(2026, 5, 19),
    }));

    let position = svc.position(&payer, apr_18_noon()).await.unwrap();

    assert_eq!(
        position.period,
        BillingPeriod {
            start: d(2026, 4, 1),
            end: d(2026, 5, 1),
        }
    );
    assert!(repo.period_writes().is_empty());
}

#[tokio::test]
async fn provider_failure_keeps_the_calendar_month_and_stores_nothing() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    payments.set_period(PeriodReply::Failed);

    let position = svc.position(&payer, apr_18_noon()).await.unwrap();

    assert_eq!(
        position.period,
        BillingPeriod {
            start: d(2026, 4, 1),
            end: d(2026, 5, 1),
        }
    );
    assert_eq!(repo.settings(&payer).await.unwrap().period_anchor, None);
}

#[tokio::test]
async fn provider_failure_rolls_an_ended_anchor_forward() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_period(&payer, d(2026, 1, 15), d(2026, 2, 15))
        .await
        .unwrap();
    payments.set_period(PeriodReply::Failed);

    let position = svc.position(&payer, apr_18_noon()).await.unwrap();

    assert_eq!(
        position.period,
        BillingPeriod {
            start: d(2026, 4, 15),
            end: d(2026, 5, 15),
        }
    );
    assert_eq!(
        repo.settings(&payer).await.unwrap().period_anchor,
        Some((d(2026, 1, 15), d(2026, 2, 15)))
    );
}

#[tokio::test]
async fn a_failed_read_is_not_repeated_for_a_minute() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    payments.set_period(PeriodReply::Failed);
    let first = apr_18_noon();

    svc.position(&payer, first).await.unwrap();
    let within = svc
        .position(&payer, first + chrono::Duration::seconds(59))
        .await
        .unwrap();
    assert_eq!(
        within.period,
        BillingPeriod {
            start: d(2026, 4, 1),
            end: d(2026, 5, 1),
        }
    );
    assert_eq!(payments.period_requests().len(), 1);

    payments.set_period(PeriodReply::Found(BillingPeriod {
        start: d(2026, 4, 10),
        end: d(2026, 5, 10),
    }));
    let after = svc
        .position(&payer, first + chrono::Duration::seconds(60))
        .await
        .unwrap();
    assert_eq!(
        after.period,
        BillingPeriod {
            start: d(2026, 4, 10),
            end: d(2026, 5, 10),
        }
    );
    assert_eq!(payments.period_requests().len(), 2);
    assert_eq!(
        repo.settings(&payer).await.unwrap().period_anchor,
        Some((d(2026, 4, 10), d(2026, 5, 10)))
    );
}

#[tokio::test]
async fn an_empty_or_unadoptable_read_is_not_repeated_for_a_minute() {
    let future_window = PeriodReply::Found(BillingPeriod {
        start: d(2026, 4, 19),
        end: d(2026, 5, 19),
    });
    for reply in [PeriodReply::Missing, future_window] {
        let (svc, _, payments, _) = premium_service(0);
        let payer = user("payer@x.com");
        payments.set_period(reply);

        svc.position(&payer, apr_18_noon()).await.unwrap();
        let again = svc
            .position(&payer, apr_18_noon() + chrono::Duration::seconds(30))
            .await
            .unwrap();

        assert_eq!(
            again.period,
            BillingPeriod {
                start: d(2026, 4, 1),
                end: d(2026, 5, 1),
            },
            "{reply:?}"
        );
        assert_eq!(payments.period_requests().len(), 1, "{reply:?}");
    }
}

#[tokio::test]
async fn covering_anchor_never_reads_the_provider() {
    let (svc, repo, payments, _) = premium_service(0);
    let payer = user("payer@x.com");
    repo.set_period(&payer, d(2026, 4, 1), d(2026, 5, 1))
        .await
        .unwrap();
    payments.set_period(PeriodReply::Found(BillingPeriod {
        start: d(2026, 1, 1),
        end: d(2026, 2, 1),
    }));

    let position = svc.position(&payer, apr_18_noon()).await.unwrap();

    assert_eq!(
        position.period,
        BillingPeriod {
            start: d(2026, 4, 1),
            end: d(2026, 5, 1),
        }
    );
    assert_eq!(
        repo.settings(&payer).await.unwrap().period_anchor,
        Some((d(2026, 4, 1), d(2026, 5, 1)))
    );
    assert!(payments.period_requests().is_empty());
}

#[tokio::test]
async fn free_and_unlimited_payers_never_read_the_provider() {
    let free = user("free@x.com");
    let unlimited = user("unlimited@x.com");
    let entitlements = FakeEntitlements::default()
        .with(Entitlement::personal(free.clone(), PlanTier::Free))
        .with(Entitlement {
            unlimited: true,
            ..Entitlement::personal(unlimited.clone(), PlanTier::Premium)
        })
        .with_customer(&free, "cus_free")
        .with_customer(&unlimited, "cus_unlimited");
    let payments = FakePayments::default();
    payments.set_period(PeriodReply::Found(BillingPeriod {
        start: d(2026, 4, 10),
        end: d(2026, 5, 10),
    }));
    let svc = BillingServiceImpl::new(
        entitlements,
        FakeUsage::default(),
        FakeRepo::default(),
        payments.clone(),
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

    for payer in [free, unlimited] {
        let position = svc.position(&payer, apr_18_noon()).await.unwrap();
        assert_eq!(
            position.period,
            BillingPeriod {
                start: d(2026, 4, 1),
                end: d(2026, 5, 1),
            },
            "{payer}"
        );
    }
    assert!(payments.period_requests().is_empty());
}

#[tokio::test]
async fn payer_without_a_stripe_customer_never_reads_the_provider() {
    let payer = user("payer@x.com");
    let payments = FakePayments::default();
    payments.set_period(PeriodReply::Found(BillingPeriod {
        start: d(2026, 4, 10),
        end: d(2026, 5, 10),
    }));
    let svc = BillingServiceImpl::new(
        FakeEntitlements::default().with(Entitlement::personal(payer.clone(), PlanTier::Premium)),
        FakeUsage::default(),
        FakeRepo::default(),
        payments.clone(),
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

    let position = svc.position(&payer, apr_18_noon()).await.unwrap();

    assert_eq!(
        position.period,
        BillingPeriod {
            start: d(2026, 4, 1),
            end: d(2026, 5, 1),
        }
    );
    assert!(payments.period_requests().is_empty());
}

#[tokio::test]
async fn team_member_reads_the_owner_subscription_in_team_scope() {
    let owner = user("owner@x.com");
    let member = user("member@x.com");
    let team_id = Uuid::from_u128(7);
    let repo = FakeRepo::default();
    let payments = FakePayments::default();
    payments.set_period(PeriodReply::Found(BillingPeriod {
        start: d(2026, 4, 10),
        end: d(2026, 5, 10),
    }));
    let svc = BillingServiceImpl::new(
        FakeEntitlements::default()
            .with(premium_team(&owner, &member, team_id))
            .with_customer(&owner, "cus_owner"),
        FakeUsage::default(),
        repo.clone(),
        payments.clone(),
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

    let position = svc.position(&member, apr_18_noon()).await.unwrap();

    assert_eq!(
        position.period,
        BillingPeriod {
            start: d(2026, 4, 10),
            end: d(2026, 5, 10),
        }
    );
    assert_eq!(
        payments.period_requests(),
        vec![(
            "cus_owner".to_string(),
            SubscriptionScope::Team {
                team_id: Uuid::from_u128(7)
            }
        )]
    );
    assert_eq!(
        repo.period_writes(),
        vec![(
            "macro|owner@x.com".to_string(),
            d(2026, 4, 10),
            d(2026, 5, 10)
        )]
    );
}

#[tokio::test]
async fn release_uses_the_subscription_period() {
    let owner = user("owner@x.com");
    let member = user("member@x.com");
    let team_id = Uuid::from_u128(7);
    let repo = FakeRepo::default();
    let payments = FakePayments::default();
    payments.set_period(PeriodReply::Found(BillingPeriod {
        start: d(2026, 3, 20),
        end: d(2026, 4, 20),
    }));
    let svc = BillingServiceImpl::new(
        FakeEntitlements::default()
            .with(premium_team(&owner, &member, team_id))
            .with_customer(&owner, "cus_owner")
            .payer_for_team(team_id, owner.clone()),
        FakeUsage::default(),
        repo.clone(),
        payments,
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

    svc.release_at(team_id, &member, apr_18_noon())
        .await
        .unwrap();

    assert_eq!(
        repo.releases(),
        vec![(
            "macro|owner@x.com".to_string(),
            d(2026, 3, 20),
            "macro|member@x.com".to_string()
        )]
    );
}

#[tokio::test]
async fn release_with_a_covering_anchor_never_reads_the_entitlement() {
    let owner = user("owner@x.com");
    let member = user("member@x.com");
    let team_id = Uuid::from_u128(7);
    let repo = FakeRepo::default();
    repo.set_period(&owner, d(2026, 4, 10), d(2026, 5, 10))
        .await
        .unwrap();
    let payments = FakePayments::default();
    let entitlements = FakeEntitlements::default()
        .with(premium_team(&owner, &member, team_id))
        .with_customer(&owner, "cus_owner")
        .payer_for_team(team_id, owner.clone());
    *entitlements.fail_entitlement.lock().unwrap() = true;
    let svc = BillingServiceImpl::new(
        entitlements,
        FakeUsage::default(),
        repo.clone(),
        payments.clone(),
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

    svc.release_at(team_id, &member, apr_18_noon())
        .await
        .unwrap();

    assert_eq!(
        repo.releases(),
        vec![(
            "macro|owner@x.com".to_string(),
            d(2026, 4, 10),
            "macro|member@x.com".to_string()
        )]
    );
    assert!(payments.period_requests().is_empty());
}

#[tokio::test]
async fn release_rolls_an_ended_anchor_when_the_entitlement_read_fails() {
    let owner = user("owner@x.com");
    let member = user("member@x.com");
    let team_id = Uuid::from_u128(7);
    let repo = FakeRepo::default();
    repo.set_period(&owner, d(2026, 1, 15), d(2026, 2, 15))
        .await
        .unwrap();
    let entitlements = FakeEntitlements::default()
        .with(premium_team(&owner, &member, team_id))
        .with_customer(&owner, "cus_owner")
        .payer_for_team(team_id, owner.clone());
    *entitlements.fail_entitlement.lock().unwrap() = true;
    let svc = BillingServiceImpl::new(
        entitlements,
        FakeUsage::default(),
        repo.clone(),
        FakePayments::default(),
        AiPricing::testing(),
    )
    .with_billing(AiUsageBilling::Enabled);

    svc.release_at(team_id, &member, apr_18_noon())
        .await
        .unwrap();

    assert_eq!(
        repo.releases(),
        vec![(
            "macro|owner@x.com".to_string(),
            d(2026, 4, 15),
            "macro|member@x.com".to_string()
        )]
    );
}
