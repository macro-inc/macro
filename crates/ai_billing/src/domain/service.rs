//! The billing service: the gate, the summary, settings, credit purchases, and
//! settlement.

#[cfg(test)]
mod test;

use super::ledger::{SettlementPolicy, build_snapshot, decide};
use super::models::{
    AllowanceDecision, BillingError, BillingPeriod, BillingSettings, CREDIT_PACKS_CENTS,
    Entitlement, OVERAGE_CHARGE_THRESHOLD_CENTS, OVERAGE_LIMIT_MAX_CENTS, OVERAGE_LIMIT_MIN_CENTS,
    OverageChargeStatus, PlanTier, Result, UsageSnapshot,
};
use super::ports::{
    BillingRepo, BillingService, CreditCheckoutRequest, EntitlementSource, OverageChargeRequest,
    PaymentGateway, PendingCharge, UsageReader,
};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;

/// The billing service over its four ports.
#[derive(Clone)]
pub struct BillingServiceImpl<E, U, R, P> {
    entitlements: E,
    usage: U,
    repo: R,
    payments: P,
}

impl<E, U, R, P> BillingServiceImpl<E, U, R, P> {
    /// Construct the service.
    pub fn new(entitlements: E, usage: U, repo: R, payments: P) -> Self {
        Self {
            entitlements,
            usage,
            repo,
            payments,
        }
    }
}

/// Everything resolved for one user at one instant.
struct Position {
    entitlement: Entitlement,
    settings: BillingSettings,
    period: BillingPeriod,
}

impl<E, U, R, P> BillingServiceImpl<E, U, R, P>
where
    E: EntitlementSource,
    U: UsageReader,
    R: BillingRepo,
    P: PaymentGateway,
{
    async fn position(&self, user: &MacroUserIdStr<'_>, now: DateTime<Utc>) -> Result<Position> {
        let entitlement = self.entitlements.entitlement(user).await?;
        let settings = self.repo.settings(&entitlement.payer).await?;
        let period = BillingPeriod::current(settings.period_anchor, now);
        Ok(Position {
            entitlement,
            settings,
            period,
        })
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
        let (used_cents, ledger, credit_balance_cents) = if entitlement.tier.is_paid() {
            let used = self
                .usage
                .list_rate_usage_cents(&entitlement.billed_users, *period)
                .await?;
            let ledger = self
                .repo
                .period_ledger(&entitlement.payer, period.start)
                .await?;
            let balance = self.repo.credit_balance_cents(&entitlement.payer).await?;
            (used, ledger, balance)
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
            ledger,
            credit_balance_cents,
        ))
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
        let used_cents = self
            .usage
            .list_rate_usage_cents(&entitlement.billed_users, period)
            .await?;
        let included_cents = entitlement.included_ai_cents();
        if used_cents <= included_cents {
            return Ok(());
        }

        let outcome = self
            .repo
            .apply_settlement(
                &entitlement.payer,
                period.start,
                used_cents,
                included_cents,
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

    /// Collect a reserved overage charge; a failure suspends overage.
    async fn collect(
        &self,
        entitlement: &Entitlement,
        period: BillingPeriod,
        charge: PendingCharge,
    ) -> Result<()> {
        let payer = &entitlement.payer;
        let Some(customer_id) = self.entitlements.stripe_customer_id(payer).await? else {
            tracing::warn!("overage charge reserved but payer has no stripe customer");
            self.repo
                .finish_overage_charge(charge.id, None, OverageChargeStatus::Failed)
                .await?;
            self.repo.suspend_overage(payer).await?;
            return Err(BillingError::NoStripeCustomer);
        };

        let description = format!(
            "Macro AI usage beyond plan, {} to {}",
            period.start.format("%b %-d"),
            period.end.format("%b %-d, %Y")
        );
        match self
            .payments
            .charge_overage(OverageChargeRequest {
                customer_id,
                charge_id: charge.id,
                amount_cents: charge.amount_cents,
                description,
            })
            .await
        {
            Ok(receipt) => {
                let status = if receipt.paid {
                    OverageChargeStatus::Paid
                } else {
                    // Left open for Stripe's retries; the webhook settles it.
                    OverageChargeStatus::Pending
                };
                self.repo
                    .finish_overage_charge(charge.id, Some(&receipt.invoice_id), status)
                    .await?;
                tracing::info!(
                    cents = charge.amount_cents,
                    invoice = %receipt.invoice_id,
                    paid = receipt.paid,
                    "collected ai overage"
                );
                Ok(())
            }
            Err(e) => {
                tracing::error!(error = ?e, cents = charge.amount_cents, "ai overage charge failed");
                self.repo
                    .finish_overage_charge(charge.id, None, OverageChargeStatus::Failed)
                    .await?;
                self.repo.suspend_overage(payer).await?;
                Err(e)
            }
        }
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

impl<E, U, R, P> BillingService for BillingServiceImpl<E, U, R, P>
where
    E: EntitlementSource,
    U: UsageReader,
    R: BillingRepo,
    P: PaymentGateway,
{
    #[tracing::instrument(skip(self), err)]
    async fn check_allowance(&self, user: &MacroUserIdStr<'_>) -> Result<AllowanceDecision> {
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
        self.snapshot_at(user, &position).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn settle(&self, user: &MacroUserIdStr<'_>) -> Result<()> {
        let now = Utc::now();
        let position = self.position(user, now).await?;
        if position.entitlement.unlimited || !position.entitlement.tier.is_paid() {
            return Ok(());
        }
        // The previous period first, so a tail that ran past the boundary is
        // flushed before the current one accrues.
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
    ) -> Result<()> {
        if start >= end {
            tracing::warn!("ignoring inverted subscription period");
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
            return Ok(());
        };
        if paid {
            self.repo.clear_overage_suspension(&payer).await
        } else {
            self.repo.suspend_overage(&payer).await
        }
    }
}
