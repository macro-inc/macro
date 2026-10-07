//! The billing service: the gate, the summary, settings, credit purchases, and
//! settlement.

#[cfg(test)]
mod test;

use super::ledger::{SettlementPolicy, build_snapshot, decide};
use super::models::{
    AiUsageBilling, AllowanceDecision, AllowanceStore, AutoReloadThresholds, BillingError,
    BillingPeriod, BillingSettings, CREDIT_PACKS_CENTS, CreditReloadStatus, Entitlement,
    OVERAGE_CHARGE_THRESHOLD_CENTS, OverageChargeStatus, PayerScope, PeriodAllowance, PeriodLedger,
    Result, SeatAllowance, SeatUsage, SubscriptionScope, UsageSnapshot,
};
use super::period::{PeriodSync, SubscriptionPeriod};
use super::ports::{
    BillingRepo, BillingService, CreditCheckoutRequest, CreditReloadRequest, EntitlementSource,
    PaymentGateway, PendingReload, UsageReader,
};
use super::pricing::AiPricing;
use ai_usage::AiUsageEnforcement;
use chrono::{DateTime, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use macro_uuid::Uuid;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, PoisonError};
use teams::domain::open_seat_release::OpenSeatRelease;

/// How long a payer whose subscription period read came back empty, failed,
/// or did not contain `now` meters the fallback period before the next read.
/// A miss stores nothing, so without this every AI request from that payer
/// would read the provider again. One minute bounds that to one read per
/// payer per process while Stripe rolls a period or a provider recovers.
const PERIOD_MISS_BACKOFF: chrono::Duration = chrono::Duration::minutes(1);

/// The billing service over its four ports.
#[derive(Clone)]
pub struct BillingServiceImpl<E, U, R, P> {
    entitlements: E,
    usage: U,
    repo: R,
    payments: P,
    pricing: AiPricing,
    enforcement: AiUsageEnforcement,
    billing: AiUsageBilling,
    period_sync: Option<Arc<dyn PeriodSync>>,
    /// Payers whose last subscription period read missed, and until when the
    /// read is not repeated. Shared by clones so every holder of this service
    /// in a process backs off together.
    period_misses: Arc<Mutex<HashMap<String, DateTime<Utc>>>>,
}

impl<E, U, R, P> BillingServiceImpl<E, U, R, P> {
    /// Construct over the four ports with the configured pricing, and with quota
    /// enforcement and settlement both disabled. Production composition must
    /// explicitly install each configured policy.
    pub fn new(entitlements: E, usage: U, repo: R, payments: P, pricing: AiPricing) -> Self {
        Self {
            entitlements,
            usage,
            repo,
            payments,
            pricing,
            enforcement: AiUsageEnforcement::Disabled,
            billing: AiUsageBilling::Disabled,
            period_sync: None,
            period_misses: Arc::default(),
        }
    }

    /// The pricing this service was composed with.
    pub const fn pricing(&self) -> AiPricing {
        self.pricing
    }

    /// Configure quota enforcement independently of settlement.
    pub fn with_enforcement(mut self, enforcement: AiUsageEnforcement) -> Self {
        self.enforcement = enforcement;
        self
    }

    /// Configure settlement (credit consumption and automatic reloads) from
    /// the host's `ENABLE_AI_USAGE_BILLING` policy, independently of admission.
    pub fn with_billing(mut self, billing: AiUsageBilling) -> Self {
        self.billing = billing;
        self
    }

    /// Install verified renewal activation at the composition root only after the
    /// producer and rollout gates pass. Absence never authorizes the new policy.
    pub fn with_period_sync(mut self, period_sync: Arc<dyn PeriodSync>) -> Self {
        self.period_sync = Some(period_sync);
        self
    }
}

/// Whether settling a period may first top up credits automatically.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ReloadCheck {
    /// A closed period is settled from what is on hand.
    Skip,
    /// The open period reloads credits before consuming them.
    Current,
}

/// `cents` as a dollar amount for an invoice line, e.g. `$95.00`.
fn dollars(cents: i64) -> String {
    format!("${}.{:02}", cents / 100, cents % 100)
}

/// Everything resolved for one user at one instant.
struct Position {
    entitlement: Entitlement,
    settings: BillingSettings,
    period: BillingPeriod,
}

fn usage_for(user: &MacroUserIdStr<'_>, usage: &[SeatUsage]) -> i64 {
    usage
        .iter()
        .find(|entry| entry.user.as_ref() == user.as_ref())
        .map(|entry| entry.used_cents)
        .unwrap_or(0)
}

/// Cost cents of usage beyond each seat's own allowance, summed for the payer.
fn chargeable_cost_cents(seats: &[SeatAllowance], usage: &[SeatUsage]) -> i64 {
    seats
        .iter()
        .map(|seat| (usage_for(&seat.user, usage) - seat.included_cents).max(0))
        .sum()
}

fn same_seat_pairs(left: &[SeatAllowance], right: &[SeatAllowance]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    let mut left_pairs: Vec<(&str, i64)> = left
        .iter()
        .map(|seat| (seat.user.as_ref(), seat.included_cents))
        .collect();
    let mut right_pairs: Vec<(&str, i64)> = right
        .iter()
        .map(|seat| (seat.user.as_ref(), seat.included_cents))
        .collect();
    left_pairs.sort_unstable();
    right_pairs.sort_unstable();
    left_pairs == right_pairs
}

impl<E, U, R, P> BillingServiceImpl<E, U, R, P>
where
    E: EntitlementSource,
    U: UsageReader,
    R: BillingRepo,
    P: PaymentGateway,
{
    async fn position(&self, user: &MacroUserIdStr<'_>, now: DateTime<Utc>) -> Result<Position> {
        let first = self.entitlements.entitlement(user).await?;
        let settings = self.repo.settings(&first.payer).await?;
        let period = self.usage_period(&first, settings.period_anchor, now).await;
        if !first.is_metered() {
            return Ok(Position {
                entitlement: first,
                settings,
                period,
            });
        }
        let Some(open) = period.open_start(now) else {
            return Ok(Position {
                entitlement: first,
                settings,
                period,
            });
        };
        let stored = self
            .repo
            .period_allowance(&first.payer, open.start())
            .await?;
        if stored.as_ref().is_some_and(|allowance| {
            same_seat_pairs(&allowance.seats, &first.seat_allowances(self.pricing))
        }) {
            return Ok(Position {
                entitlement: first,
                settings,
                period,
            });
        }

        let entitlement = match &first.scope {
            PayerScope::Personal => first.clone(),
            PayerScope::TeamOwner { .. } | PayerScope::TeamMember { .. } => {
                self.entitlements.entitlement(user).await?
            }
        };
        if entitlement.payer.as_ref() != first.payer.as_ref() {
            // `settings.seat_generation` was read for `first.payer`.
            let settings = self.repo.settings(&entitlement.payer).await?;
            let period = self
                .usage_period(&entitlement, settings.period_anchor, now)
                .await;
            return Ok(Position {
                entitlement,
                settings,
                period,
            });
        }
        if !entitlement.is_metered() {
            return Ok(Position {
                entitlement,
                settings,
                period,
            });
        }

        // A conflict means a release already wrote the row. The next observation refreshes.
        match self
            .repo
            .store_open_allowance(
                &entitlement.payer,
                open,
                &entitlement.seat_allowances(self.pricing),
                settings.seat_generation,
            )
            .await?
        {
            AllowanceStore::Stored | AllowanceStore::Conflict => Ok(Position {
                entitlement,
                settings,
                period,
            }),
        }
    }

    async fn usage_period(
        &self,
        entitlement: &Entitlement,
        anchor: Option<(DateTime<Utc>, DateTime<Utc>)>,
        now: DateTime<Utc>,
    ) -> BillingPeriod {
        if !entitlement.tier.is_paid() {
            // The free cap is monthly. A Stripe anchor left behind by a lapsed
            // subscription says nothing about a free user's period.
            return BillingPeriod::calendar_month(now);
        }
        if let Some(period) = BillingPeriod::covering(anchor, now) {
            return period;
        }
        if !entitlement.is_metered() {
            return BillingPeriod::current(anchor, now);
        }
        let payer = &entitlement.payer;
        if self.period_read_missed_recently(payer, now) {
            tracing::debug!(
                "subscription period read missed recently; metering the fallback period"
            );
            return BillingPeriod::current(anchor, now);
        }
        let read = match self.entitlements.stripe_customer_id(payer).await {
            Ok(Some(customer_id)) => {
                self.payments
                    .subscription_period(&customer_id, SubscriptionScope::from(&entitlement.scope))
                    .await
            }
            Ok(None) => Ok(None),
            Err(e) => Err(e),
        };
        match read {
            Ok(Some(period)) => {
                let Some(adopted) = period.adopted(anchor, now) else {
                    tracing::warn!(
                        period_start = %period.start,
                        period_end = %period.end,
                        "subscription period past the stored anchor does not contain now; metering the fallback period"
                    );
                    self.note_period_miss(payer, now);
                    return BillingPeriod::current(anchor, now);
                };
                let _ = self
                    .repo
                    .set_period(payer, adopted.start, adopted.end)
                    .await
                    .inspect_err(
                        |e| tracing::warn!(error = ?e, "storing the subscription period failed"),
                    );
                adopted
            }
            Ok(None) => {
                tracing::debug!("no subscription period to read; metering the fallback period");
                self.note_period_miss(payer, now);
                BillingPeriod::current(anchor, now)
            }
            Err(e) => {
                tracing::warn!(
                    error = ?e,
                    "reading the subscription period failed; metering the fallback period"
                );
                self.note_period_miss(payer, now);
                BillingPeriod::current(anchor, now)
            }
        }
    }

    fn period_read_missed_recently(&self, payer: &MacroUserIdStr<'_>, now: DateTime<Utc>) -> bool {
        self.period_misses
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(payer.as_ref())
            .is_some_and(|until| now < *until)
    }

    fn note_period_miss(&self, payer: &MacroUserIdStr<'_>, now: DateTime<Utc>) {
        let mut misses = self
            .period_misses
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        misses.retain(|_, until| now < *until);
        misses.insert(payer.as_ref().to_string(), now + PERIOD_MISS_BACKOFF);
    }

    async fn release_at(
        &self,
        team_id: Uuid,
        member: &MacroUserIdStr<'_>,
        now: DateTime<Utc>,
    ) -> Result<()> {
        let Some(payer) = self.entitlements.team_payer(team_id).await? else {
            return Ok(());
        };
        if payer.as_ref() == member.as_ref() {
            return Ok(());
        }
        let settings = self.repo.settings(&payer).await?;
        let anchor = settings.period_anchor;
        let period = match BillingPeriod::covering(anchor, now) {
            Some(period) => period,
            None => match self.entitlements.entitlement(&payer).await {
                Ok(entitlement) => self.usage_period(&entitlement, anchor, now).await,
                Err(e) => {
                    tracing::warn!(
                        error = ?e,
                        "reading the payer entitlement failed; releasing in the fallback period"
                    );
                    BillingPeriod::current(anchor, now)
                }
            },
        };
        let Some(open) = period.open_start(now) else {
            return Ok(());
        };
        self.repo.release_open_seat(&payer, open, member).await
    }

    async fn snapshot_at(
        &self,
        user: &MacroUserIdStr<'_>,
        position: &Position,
    ) -> Result<UsageSnapshot> {
        let Position {
            entitlement,
            settings,
            period,
        } = position;
        let (used_cents, chargeable_customer_cents, ledger, credit_balance_cents) =
            if entitlement.tier.is_paid() {
                let seats = entitlement.seat_allowances(self.pricing);
                let users: Vec<_> = seats.iter().map(|seat| seat.user.clone()).collect();
                let usage = self.usage.usage_cost_cents_by_user(&users, *period).await?;
                let seats = self
                    .repo
                    .legacy_seats(&entitlement.payer, *period, seats)
                    .await?;
                let used = if seats.iter().any(|seat| seat.user.as_ref() == user.as_ref()) {
                    usage_for(user, &usage)
                } else {
                    0
                };
                let chargeable = self
                    .pricing
                    .extra_customer_cents(chargeable_cost_cents(&seats, &usage));
                let ledger = self
                    .repo
                    .period_ledger(&entitlement.payer, period.start)
                    .await?;
                let balance = self.repo.credit_balance_cents(&entitlement.payer).await?;
                (used, chargeable, ledger, balance)
            } else if entitlement.unlimited {
                Default::default()
            } else {
                // Free users are hard-capped at their own allowance: only their
                // usage matters, and there is no ledger, credit, or overage to read.
                let users = [user.clone().into_owned()];
                let usage = self.usage.usage_cost_cents_by_user(&users, *period).await?;
                (usage_for(user, &usage), 0, PeriodLedger::default(), 0)
            };
        Ok(build_snapshot(
            user,
            entitlement,
            settings,
            *period,
            used_cents,
            chargeable_customer_cents,
            ledger,
            credit_balance_cents,
            self.pricing,
        ))
    }

    /// Per-seat allowances to settle `period` with.
    ///
    /// A closed period uses the freeze recorded while it was open. An open
    /// period (or a closed one that was never observed) uses the live
    /// entitlement.
    async fn allowance_for_period(
        &self,
        entitlement: &Entitlement,
        period: BillingPeriod,
        now: DateTime<Utc>,
    ) -> Result<Vec<SeatAllowance>> {
        if period.has_ended(now) {
            match self
                .repo
                .period_allowance(&entitlement.payer, period.start)
                .await?
            {
                Some(PeriodAllowance { seats }) => return Ok(seats),
                None => {
                    tracing::warn!(
                        period_start = %period.start,
                        "settling a closed period with no frozen allowance; using current entitlement"
                    );
                }
            }
        }
        Ok(entitlement.seat_allowances(self.pricing))
    }

    /// Settle one period for a payer: top up credits when automatic reload
    /// asks for it, book uncovered usage from credits, then reserve and
    /// consume prepaid credits. Direct usage charges are never collected.
    #[tracing::instrument(skip(self, entitlement), fields(payer = %entitlement.payer), err)]
    async fn settle_period(
        &self,
        entitlement: &Entitlement,
        period: BillingPeriod,
        now: DateTime<Utc>,
        reload: ReloadCheck,
    ) -> Result<()> {
        let seats = self.allowance_for_period(entitlement, period, now).await?;
        let users: Vec<_> = seats.iter().map(|seat| seat.user.clone()).collect();
        let usage = self.usage.usage_cost_cents_by_user(&users, period).await?;
        // Read policy AFTER analytics. V1 execution requires a committed binding,
        // so any V1 analytics just observed must now be excluded. Filtering before
        // the usage read would race renewal activation and could double bill.
        let seats = self
            .repo
            .legacy_seats(&entitlement.payer, period, seats)
            .await?;
        let chargeable_cost = chargeable_cost_cents(&seats, &usage);
        // Mark up the cumulative total, never an increment: the repository
        // books the difference from what earlier settlements already covered.
        let chargeable_customer_cents = self.pricing.extra_customer_cents(chargeable_cost);
        if reload == ReloadCheck::Current {
            // Before credits are consumed, so the top-up covers this usage
            // from prepaid credits.
            self.reload_credits(entitlement, period.start, chargeable_customer_cents, now)
                .await?;
        }
        if chargeable_cost == 0 {
            return Ok(());
        }

        let outcome = self
            .repo
            .apply_settlement(
                &entitlement.payer,
                period.start,
                chargeable_customer_cents,
                SettlementPolicy {
                    // Disable both new charges and retries of historical charges.
                    overage_active: false,
                    overage_limit_cents: 0,
                    charge_threshold_cents: OVERAGE_CHARGE_THRESHOLD_CENTS,
                    period_ended: period.has_ended(now),
                },
            )
            .await?;

        if outcome.consumed_credits_cents > 0 {
            tracing::info!(
                cents = outcome.consumed_credits_cents,
                "applied prepaid credits to ai usage"
            );
        }

        Ok(())
    }

    /// Reserve and collect an automatic credit reload when the payer's
    /// balance, net of the usage this settlement is about to consume, is
    /// under their minimum. A card or customer problem is logged and left to
    /// the webhook or the next attempt: it leaves unfunded usage uncovered
    /// and never blocks the summary read that triggered settlement.
    async fn reload_credits(
        &self,
        entitlement: &Entitlement,
        period_start: DateTime<Utc>,
        chargeable_customer_cents: i64,
        now: DateTime<Utc>,
    ) -> Result<()> {
        let Some(reload) = self
            .repo
            .reserve_credit_reload(
                &entitlement.payer,
                period_start,
                chargeable_customer_cents,
                now,
            )
            .await?
        else {
            return Ok(());
        };
        match self.collect_reload(entitlement, reload).await {
            Ok(()) => Ok(()),
            Err(e @ (BillingError::Payment(_) | BillingError::NoStripeCustomer)) => {
                tracing::warn!(
                    error = ?e,
                    "automatic credit reload failed; unfunded usage remains uncovered"
                );
                Ok(())
            }
            Err(e) => Err(e),
        }
    }

    /// Collect a reserved credit reload: open its invoice (or pick up the one
    /// an earlier attempt opened), try to pay it, and book the credits once
    /// paid. A provider failure marks the reload failed and pauses automatic
    /// reloads until the payer saves their settings again. A recorded invoice
    /// stays on the row because Stripe may still collect it, in which case
    /// the webhook books the credits.
    async fn collect_reload(&self, entitlement: &Entitlement, reload: PendingReload) -> Result<()> {
        let payer = &entitlement.payer;
        let scope = SubscriptionScope::from(&entitlement.scope);
        let customer_id = match self.entitlements.stripe_customer_id(payer).await {
            Ok(Some(customer_id)) => customer_id,
            Ok(None) => {
                tracing::warn!("credit reload reserved but payer has no stripe customer");
                self.fail_reload(payer, reload.id).await?;
                return Err(BillingError::NoStripeCustomer);
            }
            Err(e) => {
                self.fail_reload(payer, reload.id).await?;
                return Err(e);
            }
        };

        let invoice_id = match reload.stripe_invoice_id.clone() {
            Some(invoice_id) => invoice_id,
            None => {
                let description = format!(
                    "Macro AI credits, automatic reload of {}",
                    dollars(reload.amount_cents)
                );
                match self
                    .payments
                    .open_credit_reload_invoice(CreditReloadRequest {
                        customer_id,
                        payer: payer.clone(),
                        reload_id: reload.id,
                        amount_cents: reload.amount_cents,
                        description,
                        scope,
                    })
                    .await
                {
                    Ok(invoice_id) => invoice_id,
                    Err(e) => {
                        tracing::error!(
                            error = ?e,
                            cents = reload.amount_cents,
                            "ai credit reload invoice could not be opened"
                        );
                        self.fail_reload(payer, reload.id).await?;
                        return Err(e);
                    }
                }
            }
        };
        // Record the invoice before collecting: if this process dies here the
        // next settlement pays this invoice instead of opening another.
        self.repo
            .finish_credit_reload(reload.id, Some(&invoice_id), CreditReloadStatus::Pending)
            .await?;

        match self
            .payments
            .pay_overage_invoice(reload.id, &invoice_id, scope)
            .await
        {
            Ok(true) => {
                self.repo
                    .record_credit_reload(payer, reload.amount_cents, &invoice_id)
                    .await?;
                self.repo
                    .finish_credit_reload(reload.id, Some(&invoice_id), CreditReloadStatus::Paid)
                    .await?;
                tracing::info!(
                    cents = reload.amount_cents,
                    invoice = %invoice_id,
                    "collected automatic ai credit reload"
                );
                Ok(())
            }
            Ok(false) => {
                // Declined: the invoice stays open for Stripe's retries and
                // the webhook books the credits if one succeeds.
                tracing::info!(
                    cents = reload.amount_cents,
                    invoice = %invoice_id,
                    "ai credit reload invoice awaiting payment"
                );
                Ok(())
            }
            Err(e) => {
                tracing::error!(
                    error = ?e,
                    cents = reload.amount_cents,
                    invoice = %invoice_id,
                    "ai credit reload failed"
                );
                self.fail_reload(payer, reload.id).await?;
                Err(e)
            }
        }
    }

    /// A reload that could not be collected: automatic reloads pause until
    /// the payer saves their settings again.
    async fn fail_reload(&self, payer: &MacroUserIdStr<'_>, reload_id: Uuid) -> Result<()> {
        self.repo
            .finish_credit_reload(reload_id, None, CreditReloadStatus::Failed)
            .await?;
        self.repo.suspend_auto_reload(payer).await
    }

    fn require_payer(entitlement: &Entitlement, user: &MacroUserIdStr<'_>) -> Result<()> {
        if !entitlement.is_payer(user) {
            return Err(BillingError::NotPayer);
        }
        if !entitlement.tier.is_paid() {
            return Err(BillingError::FreePlan);
        }
        Ok(())
    }
}

impl<E, U, R, P> OpenSeatRelease for BillingServiceImpl<E, U, R, P>
where
    E: EntitlementSource + Clone,
    U: UsageReader + Clone,
    R: BillingRepo + Clone,
    P: PaymentGateway + Clone,
{
    type Err = BillingError;

    #[tracing::instrument(skip(self), err)]
    async fn release(&self, team_id: Uuid, member: &MacroUserIdStr<'_>) -> Result<()> {
        self.release_at(team_id, member, Utc::now()).await
    }
}

impl<E, U, R, P> BillingService for BillingServiceImpl<E, U, R, P>
where
    E: EntitlementSource,
    U: UsageReader,
    R: BillingRepo,
    P: PaymentGateway,
{
    #[tracing::instrument(skip(self), err)]
    async fn check_allowance(&self, user: &MacroUserIdStr<'_>) -> Result<AllowanceDecision> {
        if !self.enforcement.is_enabled() {
            return Ok(AllowanceDecision::Allow);
        }
        let position = self.position(user, Utc::now()).await?;
        if position.entitlement.unlimited {
            return Ok(AllowanceDecision::Allow);
        }
        let snapshot = self.snapshot_at(user, &position).await?;
        Ok(decide(&snapshot))
    }

    #[tracing::instrument(skip(self), err)]
    async fn snapshot(&self, user: &MacroUserIdStr<'_>) -> Result<UsageSnapshot> {
        let position = self.position(user, Utc::now()).await?;
        let mut snapshot = self.snapshot_at(user, &position).await?;
        // Keep the summary consistent with the configured allowance gate.
        if !self.enforcement.is_enabled() {
            snapshot.blocked_reason = None;
        }
        Ok(snapshot)
    }

    #[tracing::instrument(skip(self), err)]
    async fn settle(&self, user: &MacroUserIdStr<'_>) -> Result<()> {
        // Guard every caller: summary reads, settings, purchases, and internal settlement.
        if !self.billing.is_enabled() {
            return Ok(());
        }
        let now = Utc::now();
        let position = self.position(user, now).await?;
        if !position.entitlement.is_metered() {
            return Ok(());
        }
        // The previous period first, so a tail that ran past the boundary is
        // flushed before the current one accrues. Closed-period settlement
        // uses the freeze recorded while that period was open, not the live
        // plan or seat list.
        self.settle_period(
            &position.entitlement,
            position.period.previous(),
            now,
            ReloadCheck::Skip,
        )
        .await?;
        self.settle_period(
            &position.entitlement,
            position.period,
            now,
            ReloadCheck::Current,
        )
        .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn update_overage(
        &self,
        user: &MacroUserIdStr<'_>,
        enabled: bool,
        _limit_cents: i64,
    ) -> Result<UsageSnapshot> {
        let entitlement = self.entitlements.entitlement(user).await?;
        Self::require_payer(&entitlement, user)?;
        if enabled {
            return Err(BillingError::DirectUsageBillingDisabled);
        }
        self.repo
            .update_overage(&entitlement.payer, false, 0)
            .await?;
        self.snapshot(user).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn update_auto_reload(
        &self,
        user: &MacroUserIdStr<'_>,
        enabled: bool,
        thresholds: AutoReloadThresholds,
    ) -> Result<UsageSnapshot> {
        let entitlement = self.entitlements.entitlement(user).await?;
        Self::require_payer(&entitlement, user)?;
        if !enabled {
            self.repo
                .update_auto_reload(&entitlement.payer, false, 0, None)
                .await?;
            return self.snapshot(user).await;
        }
        thresholds.validate()?;
        // Preserve the stored reload opt-in, without a direct-charge cap.
        self.repo
            .update_auto_reload(&entitlement.payer, true, 0, Some(&thresholds))
            .await?;
        // A balance already under the minimum reloads now; a collection failure
        // re-suspends reloads and is reported in the snapshot.
        if let Err(e) = self.settle(user).await {
            tracing::warn!(error = ?e, "settlement after enabling automatic reload failed");
        }
        self.snapshot(user).await
    }

    #[tracing::instrument(skip(self, success_url, cancel_url), err)]
    async fn create_credit_checkout(
        &self,
        user: &MacroUserIdStr<'_>,
        amount_cents: i64,
        success_url: String,
        cancel_url: String,
    ) -> Result<String> {
        let entitlement = self.entitlements.entitlement(user).await?;
        Self::require_payer(&entitlement, user)?;
        if !CREDIT_PACKS_CENTS.contains(&amount_cents) {
            return Err(BillingError::InvalidCreditAmount);
        }
        let customer_id = self
            .entitlements
            .stripe_customer_id(&entitlement.payer)
            .await?
            .ok_or(BillingError::NoStripeCustomer)?;
        self.payments
            .create_credit_checkout(CreditCheckoutRequest {
                customer_id,
                payer: entitlement.payer.clone(),
                amount_cents,
                success_url,
                cancel_url,
            })
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn apply_credit_purchase(
        &self,
        payer: &MacroUserIdStr<'_>,
        amount_cents: i64,
        stripe_reference: &str,
    ) -> Result<()> {
        if amount_cents <= 0 {
            return Err(BillingError::InvalidCreditAmount);
        }
        let inserted = self
            .repo
            .record_credit_purchase(payer, amount_cents, stripe_reference)
            .await?;
        if !inserted {
            tracing::info!("credit purchase already booked; ignoring retry");
            return Ok(());
        }
        // Newly bought credits cover any usage that was waiting on them.
        if let Err(e) = self.settle(payer).await {
            tracing::warn!(error = ?e, "settlement after credit purchase failed");
        }
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn sync_period(
        &self,
        payer: &MacroUserIdStr<'_>,
        start: DateTime<Utc>,
        end: DateTime<Utc>,
        verified: Option<SubscriptionPeriod>,
    ) -> Result<()> {
        if start >= end {
            tracing::warn!("ignoring inverted subscription period");
            return Ok(());
        }
        if let Some(facts) = verified {
            if facts.period != (BillingPeriod { start, end }) {
                tracing::warn!("ignoring mismatched verified subscription period");
                return Ok(());
            }
            if let Some(sync) = &self.period_sync {
                sync.sync(payer.clone().into_owned(), facts).await?;
            }
            // Item-level policy periods do not change the legacy payer anchor.
            return Ok(());
        }
        self.repo.set_period(payer, start, end).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn mark_overage_invoice(&self, stripe_invoice_id: &str, paid: bool) -> Result<()> {
        let status = if paid {
            OverageChargeStatus::Paid
        } else {
            OverageChargeStatus::Failed
        };
        let Some(payer) = self
            .repo
            .resolve_overage_invoice(stripe_invoice_id, status)
            .await?
        else {
            // Not ours, already paid, or already in this state.
            return Ok(());
        };
        // Webhooks arrive in any order. A late `paid` for an older invoice must
        // not lift the suspension a newer failure caused, and a late failure
        // must not re-suspend a payer whose newer charge went through: the
        // newest charge's outcome decides.
        match self.repo.latest_charge_status(&payer).await? {
            Some(OverageChargeStatus::Paid) => self.repo.clear_overage_suspension(&payer).await,
            Some(OverageChargeStatus::Failed) => self.repo.suspend_overage(&payer).await,
            Some(OverageChargeStatus::Pending) | None => Ok(()),
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn mark_credit_reload_invoice(&self, stripe_invoice_id: &str, paid: bool) -> Result<()> {
        let status = if paid {
            CreditReloadStatus::Paid
        } else {
            CreditReloadStatus::Failed
        };
        let Some(resolved) = self
            .repo
            .resolve_credit_reload_invoice(stripe_invoice_id, status)
            .await?
        else {
            // Not ours, already paid, or already in this state.
            return Ok(());
        };
        if !paid {
            return self.repo.suspend_auto_reload(&resolved.payer).await;
        }
        // Idempotent on the invoice: the collector may have booked these
        // credits before the webhook arrived.
        self.repo
            .record_credit_reload(&resolved.payer, resolved.amount_cents, stripe_invoice_id)
            .await?;
        // The reloaded credits cover any usage that was waiting on them.
        if let Err(e) = self.settle(&resolved.payer).await {
            tracing::warn!(error = ?e, "settlement after credit reload failed");
        }
        Ok(())
    }
}
