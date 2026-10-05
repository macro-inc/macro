//! The billing service: the gate, the summary, settings, credit purchases, and
//! settlement.

#[cfg(test)]
mod test;

use super::ledger::{SettlementPolicy, build_snapshot, decide};
use super::models::{
    AiUsageBilling, AllowanceDecision, AllowanceStore, BillingError, BillingPeriod,
    BillingSettings, CREDIT_PACKS_CENTS, Entitlement, OVERAGE_CHARGE_THRESHOLD_CENTS,
    OVERAGE_LIMIT_MAX_CENTS, OVERAGE_LIMIT_MIN_CENTS, OverageChargeStatus, PayerScope,
    PeriodAllowance, PlanTier, Result, SeatAllowance, SeatUsage, SubscriptionScope, UsageSnapshot,
};
use super::period::{PeriodSync, SubscriptionPeriod};
use super::ports::{
    BillingRepo, BillingService, CreditCheckoutRequest, EntitlementSource, OverageChargeRequest,
    PaymentGateway, PendingCharge, UsageReader,
};
use ai_usage::AiUsageEnforcement;
use chrono::{DateTime, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use macro_uuid::Uuid;
use std::sync::Arc;
use teams::domain::open_seat_release::OpenSeatRelease;

/// The billing service over its four ports.
#[derive(Clone)]
pub struct BillingServiceImpl<E, U, R, P> {
    entitlements: E,
    usage: U,
    repo: R,
    payments: P,
    enforcement: AiUsageEnforcement,
    billing: AiUsageBilling,
    period_sync: Option<Arc<dyn PeriodSync>>,
}

impl<E, U, R, P> BillingServiceImpl<E, U, R, P> {
    /// Construct with quota enforcement and settlement both disabled. Production
    /// composition must explicitly install each configured policy.
    pub fn new(entitlements: E, usage: U, repo: R, payments: P) -> Self {
        Self {
            entitlements,
            usage,
            repo,
            payments,
            enforcement: AiUsageEnforcement::Disabled,
            billing: AiUsageBilling::Disabled,
            period_sync: None,
        }
    }

    /// Configure quota enforcement independently of settlement.
    pub fn with_enforcement(mut self, enforcement: AiUsageEnforcement) -> Self {
        self.enforcement = enforcement;
        self
    }

    /// Configure settlement (credit consumption and overage collection) from
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

fn chargeable_usage_cents(seats: &[SeatAllowance], usage: &[SeatUsage]) -> i64 {
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
        if stored
            .as_ref()
            .is_some_and(|allowance| same_seat_pairs(&allowance.seats, &first.seat_allowances()))
        {
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
                &entitlement.seat_allowances(),
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

    /// The payer's usage period at `now`. Never fails the caller.
    async fn usage_period(
        &self,
        entitlement: &Entitlement,
        anchor: Option<(DateTime<Utc>, DateTime<Utc>)>,
        now: DateTime<Utc>,
    ) -> BillingPeriod {
        if let Some(period) = BillingPeriod::covering(anchor, now) {
            return period;
        }
        if !entitlement.is_metered() {
            return BillingPeriod::current(anchor, now);
        }
        let payer = &entitlement.payer;
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
                let _ = self
                    .repo
                    .set_period(payer, period.start, period.end)
                    .await
                    .inspect_err(
                        |e| tracing::warn!(error = ?e, "storing the subscription period failed"),
                    );
                BillingPeriod::current(Some((period.start, period.end)), now)
            }
            Ok(None) => {
                tracing::debug!("no subscription period to read; metering the fallback period");
                BillingPeriod::current(anchor, now)
            }
            Err(e) => {
                tracing::warn!(
                    error = ?e,
                    "reading the subscription period failed; metering the fallback period"
                );
                BillingPeriod::current(anchor, now)
            }
        }
    }

    /// Implementation behind `OpenSeatRelease::release`, with an explicit clock.
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
        let entitlement = self.entitlements.entitlement(&payer).await?;
        let settings = self.repo.settings(&payer).await?;
        let period = self
            .usage_period(&entitlement, settings.period_anchor, now)
            .await;
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
        let (used_cents, chargeable_cents, ledger, credit_balance_cents) =
            if entitlement.tier.is_paid() {
                let seats = entitlement.seat_allowances();
                let users: Vec<_> = seats.iter().map(|seat| seat.user.clone()).collect();
                let usage = self
                    .usage
                    .list_rate_usage_cents_by_user(&users, *period)
                    .await?;
                let seats = self
                    .repo
                    .legacy_seats(&entitlement.payer, *period, seats)
                    .await?;
                let used = if seats.iter().any(|seat| seat.user.as_ref() == user.as_ref()) {
                    usage_for(user, &usage)
                } else {
                    0
                };
                let chargeable = chargeable_usage_cents(&seats, &usage);
                let ledger = self
                    .repo
                    .period_ledger(&entitlement.payer, period.start)
                    .await?;
                let balance = self.repo.credit_balance_cents(&entitlement.payer).await?;
                (used, chargeable, ledger, balance)
            } else {
                // Free users are not metered here; skip the ledger reads.
                Default::default()
            };
        Ok(build_snapshot(
            user,
            entitlement,
            settings,
            *period,
            used_cents,
            chargeable_cents,
            ledger,
            credit_balance_cents,
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
        Ok(entitlement.seat_allowances())
    }

    /// Settle one period for a payer: book uncovered usage from credits, then
    /// reserve and collect an overage chunk.
    #[tracing::instrument(skip(self, entitlement), fields(payer = %entitlement.payer), err)]
    async fn settle_period(
        &self,
        entitlement: &Entitlement,
        period: BillingPeriod,
        now: DateTime<Utc>,
    ) -> Result<()> {
        let seats = self.allowance_for_period(entitlement, period, now).await?;
        let users: Vec<_> = seats.iter().map(|seat| seat.user.clone()).collect();
        let usage = self
            .usage
            .list_rate_usage_cents_by_user(&users, period)
            .await?;
        // Read policy AFTER analytics. V1 execution requires a committed binding,
        // so any V1 analytics just observed must now be excluded. Filtering before
        // the usage read would race renewal activation and could double bill.
        let seats = self
            .repo
            .legacy_seats(&entitlement.payer, period, seats)
            .await?;
        let chargeable_cents = chargeable_usage_cents(&seats, &usage);
        if chargeable_cents == 0 {
            return Ok(());
        }

        let outcome = self
            .repo
            .apply_settlement(
                &entitlement.payer,
                period.start,
                chargeable_cents,
                SettlementPolicy {
                    // The repo reads the live overage settings under its lock;
                    // these two are the caller's contribution.
                    overage_active: true,
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

        if let Some(charge) = outcome.pending_charge {
            self.collect(entitlement, period, charge).await?;
        }
        Ok(())
    }

    /// Collect a reserved overage charge: open its invoice (or pick up the
    /// one an earlier attempt opened) and try to pay it. A provider failure
    /// marks the charge failed and suspends overage until the payer re-enables
    /// it. A recorded invoice continues covering usage because Stripe may
    /// still collect it; re-enabling retries that same invoice.
    async fn collect(
        &self,
        entitlement: &Entitlement,
        period: BillingPeriod,
        charge: PendingCharge,
    ) -> Result<()> {
        let payer = &entitlement.payer;
        let scope = SubscriptionScope::from(&entitlement.scope);
        let customer_id = match self.entitlements.stripe_customer_id(payer).await {
            Ok(Some(customer_id)) => customer_id,
            Ok(None) => {
                tracing::warn!("overage charge reserved but payer has no stripe customer");
                self.fail_charge(payer, charge.id).await?;
                return Err(BillingError::NoStripeCustomer);
            }
            Err(e) => {
                // Left pending, the charge would cover usage that is never
                // invoiced. Fail it so the next settlement retries it.
                self.fail_charge(payer, charge.id).await?;
                return Err(e);
            }
        };

        let invoice_id = match charge.stripe_invoice_id.clone() {
            Some(invoice_id) => invoice_id,
            None => {
                let description = format!(
                    "Macro AI usage beyond plan, {} to {}",
                    period.start.format("%b %-d"),
                    period.end.format("%b %-d, %Y")
                );
                match self
                    .payments
                    .open_overage_invoice(OverageChargeRequest {
                        customer_id,
                        charge_id: charge.id,
                        amount_cents: charge.amount_cents,
                        description,
                        scope,
                    })
                    .await
                {
                    Ok(invoice_id) => invoice_id,
                    Err(e) => {
                        tracing::error!(
                            error = ?e,
                            cents = charge.amount_cents,
                            "ai overage invoice could not be opened"
                        );
                        self.fail_charge(payer, charge.id).await?;
                        return Err(e);
                    }
                }
            }
        };
        // Record the invoice before collecting: if this process dies here the
        // next settlement pays this invoice instead of opening another.
        self.repo
            .finish_overage_charge(charge.id, Some(&invoice_id), OverageChargeStatus::Pending)
            .await?;

        match self
            .payments
            .pay_overage_invoice(charge.id, &invoice_id, scope)
            .await
        {
            Ok(true) => {
                self.repo
                    .finish_overage_charge(charge.id, Some(&invoice_id), OverageChargeStatus::Paid)
                    .await?;
                tracing::info!(
                    cents = charge.amount_cents,
                    invoice = %invoice_id,
                    "collected ai overage"
                );
                Ok(())
            }
            Ok(false) => {
                // Declined: the invoice stays open for Stripe's retries and
                // the webhook reports the outcome either way.
                tracing::info!(
                    cents = charge.amount_cents,
                    invoice = %invoice_id,
                    "ai overage invoice awaiting payment"
                );
                Ok(())
            }
            Err(e) => {
                tracing::error!(
                    error = ?e,
                    cents = charge.amount_cents,
                    invoice = %invoice_id,
                    "ai overage charge failed"
                );
                self.fail_charge(payer, charge.id).await?;
                Err(e)
            }
        }
    }

    /// A charge that could not be collected: overage pauses until the payer
    /// re-enables it. A recorded Stripe invoice continues covering usage.
    async fn fail_charge(&self, payer: &MacroUserIdStr<'_>, charge_id: Uuid) -> Result<()> {
        self.repo
            .finish_overage_charge(charge_id, None, OverageChargeStatus::Failed)
            .await?;
        self.repo.suspend_overage(payer).await
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
        if position.entitlement.unlimited || position.entitlement.tier == PlanTier::Free {
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
        if position.entitlement.unlimited || !position.entitlement.tier.is_paid() {
            return Ok(());
        }
        // The previous period first, so a tail that ran past the boundary is
        // flushed before the current one accrues. Closed-period settlement
        // uses the freeze recorded while that period was open, not the live
        // plan or seat list.
        self.settle_period(&position.entitlement, position.period.previous(), now)
            .await?;
        self.settle_period(&position.entitlement, position.period, now)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn update_overage(
        &self,
        user: &MacroUserIdStr<'_>,
        enabled: bool,
        limit_cents: i64,
    ) -> Result<UsageSnapshot> {
        let entitlement = self.entitlements.entitlement(user).await?;
        Self::require_payer(&entitlement, user)?;
        if enabled && !(OVERAGE_LIMIT_MIN_CENTS..=OVERAGE_LIMIT_MAX_CENTS).contains(&limit_cents) {
            return Err(BillingError::InvalidOverageLimit);
        }
        let limit_cents = if enabled { limit_cents } else { 0 };
        self.repo
            .update_overage(&entitlement.payer, enabled, limit_cents)
            .await?;
        if enabled {
            // Retry anything that was waiting on overage (or a failed charge);
            // a collection failure re-suspends and is reported in the snapshot.
            if let Err(e) = self.settle(user).await {
                tracing::warn!(error = ?e, "settlement after enabling overage failed");
            }
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
}
