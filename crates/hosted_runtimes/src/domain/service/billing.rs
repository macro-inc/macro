//! Computer billing: cancel, undo, restore, billing effects and what a
//! subscription change means for each computer. The lifecycle decides; this
//! module only talks to the billing provider and feeds it events.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::{Clock, ComputerError, ComputerService, internal};
use crate::domain::ids::ComputerId;
use crate::domain::lifecycle::{
    BILLING_BACKOFF, Billing as ComputerBilling, Effect, EffectWorker, Event, Rejected,
    SubscriptionItemId, backoff, restore_allowed, undo_allowed,
};
use crate::domain::models::{ComputerRecord, ComputerStatus, Funding};
use crate::domain::ports::{
    Billing, BillingError, CompPolicy, ComputerRepo, FleetAttachmentSource, ItemCharge,
    PendingEffect,
};

/// Billing effects leased per worker pass.
const BILLING_BATCH: u32 = 16;
/// How long a leased billing effect stays hidden from other workers.
const BILLING_LEASE: chrono::Duration = chrono::Duration::minutes(2);
/// Failed attempts after which a billing item removal stops retrying and
/// pages through `computer billing item removal abandoned`.
pub const MAX_BILLING_ATTEMPTS: u32 = 10;

/// A team subscription's status, as the billing provider reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SubscriptionStatus {
    /// Paid and current.
    Active,
    /// In a trial.
    Trialing,
    /// A renewal payment failed; the provider is retrying.
    PastDue,
    /// The provider stopped retrying an unpaid renewal.
    Unpaid,
    /// Collection is paused.
    Paused,
    /// The first payment has not succeeded.
    Incomplete,
    /// The first payment never succeeded.
    IncompleteExpired,
    /// The subscription ended.
    Canceled,
}

/// One subscription item and the computer its metadata names, if any.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedItem {
    /// The item.
    pub subscription_item: SubscriptionItemId,
    /// The `computer_id` metadata on the item.
    pub computer_id: Option<ComputerId>,
}

/// A complete team subscription snapshot. The webhook only reports this;
/// [`ComputerService::observe_subscription`] decides what it means.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubscriptionObserved {
    /// The subscription's status.
    pub status: SubscriptionStatus,
    /// Every item on the subscription.
    pub items: Vec<ObservedItem>,
    /// When the current period ends.
    pub current_period_end: DateTime<Utc>,
    /// When the snapshot was read; computers whose billing changed later are left alone.
    pub observed_at: DateTime<Utc>,
}

impl<
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Attachment: FleetAttachmentSource,
    Policy: CompPolicy,
> ComputerService<Repo, Bill, Time, Attachment, Policy>
{
    /// Stop billing at the end of the current period: the computer's item is
    /// removed now without proration (the period is paid) and the computer
    /// runs until the period ends. A comped computer stops at once. Either
    /// way its disk is retained, restorable, before it is destroyed.
    #[tracing::instrument(skip(self), err)]
    pub async fn cancel(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        self.require_attached().await?;
        let computer = self.team_computer(team_id, computer_id).await?;
        let at = match computer.state.billing {
            ComputerBilling::Active { .. } => self.billing.period_end(team_id).await?,
            ComputerBilling::PastDue { .. }
            | ComputerBilling::EndsAt { .. }
            | ComputerBilling::Comped { .. } => self.clock.now(),
        };
        self.apply_for_team(team_id, computer_id, Event::CancelAtPeriodEnd { at })
            .await
    }

    /// Keep a canceled computer before its period ends: its item is re-added
    /// without proration, since the current period is already paid.
    #[tracing::instrument(skip(self), err)]
    pub async fn undo_cancel(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        self.require_attached().await?;
        let computer = self.team_computer(team_id, computer_id).await?;
        undo_allowed(&computer.state, self.clock.now())?;
        let subscription_item = self
            .readd_item(&computer, ItemCharge::NoProration, "computer-undo")
            .await?;
        self.apply_for_team(
            team_id,
            computer_id,
            Event::UndoCancel { subscription_item },
        )
        .await
    }

    /// Keep a computer whose billing ended, during retention: its item is
    /// re-added and the rest of the period invoiced now (a comped computer is
    /// comped again). The stopped guest and its disk are kept.
    #[tracing::instrument(skip(self), err)]
    pub async fn restore(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        self.require_attached().await?;
        let computer = self.team_computer(team_id, computer_id).await?;
        restore_allowed(&computer.state, self.clock.now())?;
        let billing = match &computer.funding {
            Funding::Comped { reason } => ComputerBilling::Comped {
                reason: reason.clone(),
            },
            Funding::Stripe { .. } => ComputerBilling::Active {
                subscription_item: self
                    .readd_item(&computer, ItemCharge::Prorated, "computer-restore")
                    .await?,
            },
        };
        self.apply_for_team(team_id, computer_id, Event::Restore { billing })
            .await
    }

    /// Put a canceled computer's item back. An item an earlier attempt left
    /// on the subscription (an unknown outcome) is reused rather than added
    /// again, so a retry never bills twice.
    async fn readd_item(
        &self,
        computer: &crate::domain::models::Computer,
        charge: ItemCharge,
        purpose: &str,
    ) -> Result<SubscriptionItemId, ComputerError> {
        let Funding::Stripe { price_id } = &computer.funding else {
            return Err(Rejected::InvalidRestore.into());
        };
        if let Some(item) = self
            .billing
            .computer_item(computer.team_id, computer.id)
            .await?
        {
            return Ok(item);
        }
        Ok(self
            .billing
            .add_computer(
                computer.team_id,
                computer.id,
                price_id,
                &[],
                charge,
                &format!("{purpose}:{}:{}", computer.id, Uuid::now_v7()),
            )
            .await?)
    }

    /// Decide what a team subscription snapshot means for each computer.
    /// Items are matched by the `computer_id` in their metadata, never by
    /// price or count. A billed computer whose item is missing (or whose
    /// subscription ended) stops billing and starts retention; an item that
    /// names no known computer is logged, never mapped.
    #[tracing::instrument(skip(self, observed), fields(status = ?observed.status, items = observed.items.len()), err)]
    pub async fn observe_subscription(
        &self,
        team_id: Uuid,
        observed: SubscriptionObserved,
    ) -> Result<(), ComputerError> {
        let computers = self.repo.list_for_team(team_id).await.map_err(internal)?;
        let reservations = self
            .repo
            .team_reservations(team_id)
            .await
            .map_err(internal)?;
        let ended = matches!(
            observed.status,
            SubscriptionStatus::Canceled | SubscriptionStatus::IncompleteExpired
        );
        let lapsed = matches!(
            observed.status,
            SubscriptionStatus::PastDue
                | SubscriptionStatus::Unpaid
                | SubscriptionStatus::Paused
                | SubscriptionStatus::Incomplete
        );
        let observed_at = observed.observed_at;

        for item in &observed.items {
            let known = item.computer_id.is_some_and(|id| {
                computers.iter().any(|computer| computer.id() == id)
                    || reservations.iter().any(|reservation| reservation.id == id)
            });
            if item.computer_id.is_some() && !known {
                tracing::warn!(subscription_item = %item.subscription_item, computer_id = ?item.computer_id,
                    "subscription item names no known computer; leaving it unmapped");
            }
        }

        for computer in computers.iter().filter_map(ComputerRecord::healthy) {
            let Some(billed_item) = computer.subscription_item() else {
                continue;
            };
            let observed_item = observed
                .items
                .iter()
                .find(|item| item.computer_id == Some(computer.id));
            let mut events = Vec::new();
            match observed_item {
                _ if ended => events.push(Event::BillingItemMissing { observed_at }),
                None => events.push(Event::BillingItemMissing { observed_at }),
                Some(item) => {
                    if &item.subscription_item != billed_item {
                        events.push(Event::BillingItemMoved {
                            subscription_item: item.subscription_item.clone(),
                            observed_at,
                        });
                    }
                    events.push(if lapsed {
                        Event::PaymentLapsed { observed_at }
                    } else {
                        Event::PaymentRecovered { observed_at }
                    });
                }
            }
            for event in events {
                if matches!(event, Event::BillingItemMissing { .. }) {
                    tracing::warn!(computer_id = %computer.id, "computer's subscription item is gone");
                }
                self.apply(computer.id, event).await?;
            }
        }
        tracing::debug!(current_period_end = %observed.current_period_end, "subscription observed");
        Ok(())
    }

    /// Carry out due billing effects and settle purchases being confirmed.
    /// One failing effect is retried later and never blocks the others.
    pub async fn run_billing_effects(&self) -> Result<usize, ComputerError> {
        let now = self.clock.now();
        let effects = self
            .repo
            .lease_effects(
                EffectWorker::Billing,
                BILLING_BATCH,
                now,
                now + BILLING_LEASE,
            )
            .await
            .map_err(internal)?;
        let count = effects.len();
        for pending in effects {
            self.run_billing_effect(pending, now).await?;
        }
        Ok(count + self.confirm_reservations().await?)
    }

    async fn run_billing_effect(
        &self,
        pending: PendingEffect,
        now: DateTime<Utc>,
    ) -> Result<(), ComputerError> {
        use tracing::Instrument;
        let span = tracing::info_span!("computer.billing.effect", computer_id = %pending.computer_id, effect_id = pending.id, attempts = i64::from(pending.attempts), otel.status_code = tracing::field::Empty);
        let computer = self
            .repo
            .get(pending.computer_id)
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?
            .into_healthy()
            .map_err(|_| ComputerError::NeedsAttention)?;
        super::super::telemetry::adopt(&span, &computer.state);
        async {
            let outcome = match &pending.effect {
                Effect::RemoveBillingItem { subscription_item } => {
                    // One removal per outbox row: a retry after a lost response is a no-op.
                    match self
                        .billing
                        .remove_computer(
                            computer.team_id,
                            subscription_item,
                            &format!("computer-remove:{}", pending.id),
                        )
                        .await
                    {
                        // A subscription that is gone took the item with it.
                        Ok(()) | Err(BillingError::NoSubscription) => Ok(()),
                        Err(error) => Err(error),
                    }
                }
                Effect::Create { .. }
                | Effect::Start { .. }
                | Effect::Stop { .. }
                | Effect::Restart { .. }
                | Effect::RestartMacrod { .. }
                | Effect::Destroy { .. }
                | Effect::RevokeHarness
                | Effect::ScheduleTimer { .. }
                | Effect::PageOperator { .. } => {
                    return Err(ComputerError::Internal(rootcause::report!(
                        "a fleet effect reached the billing worker"
                    )));
                }
            };
            match outcome {
                Ok(()) => self
                    .repo
                    .complete_effect(pending.id)
                    .await
                    .map_err(internal),
                Err(error) => {
                    super::super::telemetry::effect_failed("billing");
                    tracing::Span::current().record("otel.status_code", "ERROR");
                    let attempts = pending.attempts.saturating_add(1);
                    if attempts >= MAX_BILLING_ATTEMPTS {
                        // Alerting keys on this event; see the crate's AGENTS.md.
                        tracing::error!(computer_id = %pending.computer_id, effect_id = pending.id,
                            attempts, error = ?error, "computer billing item removal abandoned");
                        return self
                            .repo
                            .complete_effect(pending.id)
                            .await
                            .map_err(internal);
                    }
                    tracing::warn!(effect_id = pending.id, error = ?error, "billing effect failed");
                    let attempt = u8::try_from(pending.attempts).unwrap_or(u8::MAX);
                    self.repo
                        .retry_effect(
                            pending.id,
                            error.to_string(),
                            now + backoff(BILLING_BACKOFF, attempt),
                        )
                        .await
                        .map_err(internal)
                }
            }
        }
        .instrument(span)
        .await
    }
}
