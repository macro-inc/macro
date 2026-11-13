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
    Applied, Billing, BillingError, ChargeStatus, CompPolicy, ComputerRepo, FleetAttachmentSource,
    ItemCharge, PendingEffect,
};

/// Billing effects leased per worker pass.
const BILLING_BATCH: u32 = 16;
/// How long a leased billing effect stays hidden from other workers.
const BILLING_LEASE: chrono::Duration = chrono::Duration::minutes(2);
/// Failed attempts after which a billing item removal stops retrying and
/// pages through `computer billing item removal abandoned`.
pub const MAX_BILLING_ATTEMPTS: u32 = 10;
/// Definitely failed re-add attempts after which one cancellation can no
/// longer be undone or restored.
const MAX_READD_ATTEMPTS: u32 = 32;

/// Which kept-computer request re-adds the billing item.
#[derive(Debug, Clone, Copy)]
enum Readd {
    UndoCancel,
    Restore,
}

impl Readd {
    fn purpose(self) -> &'static str {
        match self {
            Self::UndoCancel => "computer-undo",
            Self::Restore => "computer-restore",
        }
    }
}

/// The add key of one undo or restore attempt: stable for the cancellation
/// (the billing state it re-adds from), so a retry of the same intent replays
/// the same change.
fn readd_key(computer: &crate::domain::models::Computer, purpose: &str, attempt: u32) -> String {
    format!(
        "{purpose}:{}:{}:{attempt}",
        computer.id,
        computer.state.billing_changed_at.timestamp_micros()
    )
}

/// The key of one generation of a billing effect's item removal.
fn removal_key(effect_id: i64, generation: u32) -> String {
    format!("computer-remove:{effect_id}:{generation}")
}

/// One removal per stray item and snapshot: a later snapshot tries again.
fn stray_key(item: &SubscriptionItemId, observed_at: DateTime<Utc>) -> String {
    format!("computer-stray:{item}:{}", observed_at.timestamp_micros())
}

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
            // The lifecycle refuses a pool or still-charging computer's cancel.
            ComputerBilling::PastDue { .. }
            | ComputerBilling::EndsAt { .. }
            | ComputerBilling::Comped { .. }
            | ComputerBilling::Pool
            | ComputerBilling::Charging => self.clock.now(),
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
        self.readd(team_id, computer_id, Readd::UndoCancel).await
    }

    /// Keep a computer whose billing ended, during retention: its item is
    /// re-added and the rest of the period invoiced now (a comped computer is
    /// comped again while the comp policy still comps its team). The stopped
    /// guest and its disk are kept.
    #[tracing::instrument(skip(self), err)]
    pub async fn restore(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, ComputerError> {
        self.require_attached().await?;
        self.readd(team_id, computer_id, Readd::Restore).await
    }

    /// Under the computer's billing guard: check the request against the
    /// state as it is now, re-add the item, then apply the event. A
    /// concurrent request waits and then finds the computer already kept, so
    /// it never charges. A charge whose event the lifecycle then refuses (a
    /// timer won the race) is removed again.
    async fn readd(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        intent: Readd,
    ) -> Result<ComputerStatus, ComputerError> {
        let _billing = self
            .repo
            .lock_billing(computer_id)
            .await
            .map_err(internal)?;
        let computer = self.team_computer(team_id, computer_id).await?;
        let now = self.clock.now();
        match intent {
            Readd::UndoCancel => undo_allowed(&computer.state, now)?,
            Readd::Restore => restore_allowed(&computer.state, now)?,
        }
        let Some(funding) = computer.funding() else {
            return Err(Rejected::InPool.into());
        };
        let (event, charged) = match (funding, intent) {
            (Funding::Comped { .. }, Readd::Restore) => {
                // The comp is the team's now, not the one it was bought with.
                let Some(reason) = self
                    .comp_policy
                    .comp_reason(team_id)
                    .await
                    .map_err(internal)?
                else {
                    return Err(Rejected::InvalidRestore.into());
                };
                (
                    Event::Restore {
                        billing: ComputerBilling::Comped { reason },
                    },
                    None,
                )
            }
            (Funding::Comped { .. }, Readd::UndoCancel) => {
                return Err(Rejected::InvalidRestore.into());
            }
            (Funding::Stripe { price_id }, intent) => {
                // Even reusing an item still on the subscription keeps a
                // computer, which trialing teams may not.
                self.billing.require_paid_plan(team_id).await?;
                let charge = match intent {
                    Readd::UndoCancel => ItemCharge::NoProration,
                    Readd::Restore => ItemCharge::Prorated,
                };
                let subscription_item = self
                    .readd_item(team_id, &computer, price_id, charge, intent.purpose())
                    .await?;
                let event = match intent {
                    Readd::UndoCancel => Event::UndoCancel {
                        subscription_item: subscription_item.clone(),
                    },
                    Readd::Restore => Event::Restore {
                        billing: ComputerBilling::Active {
                            subscription_item: subscription_item.clone(),
                        },
                    },
                };
                (event, Some(subscription_item))
            }
        };
        // Stamped after the charge, so a snapshot read before the item
        // existed cannot end this billing again.
        let applied = self
            .repo
            .apply(computer_id, event, self.clock.now())
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?;
        match applied {
            Applied::Changed(computer) => self.status_of(&(*computer).into()).await,
            Applied::Rejected(rejected) => {
                if let Some(subscription_item) = charged {
                    self.compensate(team_id, computer_id, &subscription_item)
                        .await;
                }
                Err(rejected.into())
            }
        }
    }

    /// Remove an item re-added for an event the lifecycle refused. A failure
    /// is left to reconcile, which removes items naming an unbilled computer.
    async fn compensate(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        subscription_item: &SubscriptionItemId,
    ) {
        if let Err(error) = self
            .billing
            .remove_computer(
                team_id,
                subscription_item,
                &format!("computer-compensate:{subscription_item}"),
            )
            .await
        {
            tracing::error!(computer_id = %computer_id, subscription_item = %subscription_item,
                error = ?error, "computer billing compensation failed; reconcile removes the item");
        }
    }

    /// Put a canceled computer's item back, under the billing guard. An item
    /// still on the subscription (a removal not run yet, or an earlier
    /// attempt with a lost answer) is reused, so a retry never bills twice.
    /// Otherwise the add is keyed by this cancellation and an attempt
    /// number: a retry of the same intent replays the same key, and only a
    /// key whose change definitely ended is skipped for the next.
    async fn readd_item(
        &self,
        team_id: Uuid,
        computer: &crate::domain::models::Computer,
        price_id: &stripe::PriceId,
        charge: ItemCharge,
        purpose: &str,
    ) -> Result<SubscriptionItemId, ComputerError> {
        if let Some(item) = self.billing.computer_item(team_id, computer.id).await? {
            return Ok(item);
        }
        for attempt in 0..MAX_READD_ATTEMPTS {
            let key = readd_key(computer, purpose, attempt);
            match self.billing.charge_status(&key).await? {
                // Spent: refused, given up, or applied and since removed.
                Some(ChargeStatus::NotApplied | ChargeStatus::Applied) => continue,
                None | Some(ChargeStatus::Pending) => {
                    return Ok(self
                        .billing
                        .add_computer(team_id, computer.id, price_id, &[], charge, &key)
                        .await?);
                }
            }
        }
        Err(ComputerError::Internal(rootcause::report!(
            "too many failed attempts to re-add this computer's billing item"
        )))
    }

    /// Decide what a team subscription snapshot means for each computer.
    /// Items are matched by the `computer_id` in their metadata, never by
    /// price or count. A billed computer whose item is missing (or whose
    /// subscription ended) stops billing and starts retention. An item the
    /// computer is not billed on (a duplicate, or one naming a canceled,
    /// released or unknown computer) is removed. Every computer is tried;
    /// the first failure is returned so the snapshot is delivered again.
    #[tracing::instrument(skip(self, observed), fields(status = ?observed.status, items = observed.items.len()), err)]
    pub async fn observe_subscription(
        &self,
        team_id: Uuid,
        observed: SubscriptionObserved,
    ) -> Result<(), ComputerError> {
        // Reservations first: one converting meanwhile is then listed as a computer.
        let reservations = self
            .repo
            .team_reservations(team_id)
            .await
            .map_err(internal)?;
        let computers = self.repo.list_for_team(team_id).await.map_err(internal)?;
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
        let mut first_error = None;

        if !ended {
            for item in &observed.items {
                let Some(computer_id) = item.computer_id else {
                    continue;
                };
                let known = computers
                    .iter()
                    .any(|computer| computer.id() == computer_id)
                    || reservations
                        .iter()
                        .any(|reservation| reservation.id == computer_id);
                if known {
                    continue;
                }
                tracing::warn!(subscription_item = %item.subscription_item, computer_id = %computer_id,
                    "subscription item names no live computer; removing it");
                if let Err(error) = self
                    .billing
                    .remove_computer(
                        team_id,
                        &item.subscription_item,
                        &stray_key(&item.subscription_item, observed_at),
                    )
                    .await
                {
                    first_error.get_or_insert(error.into());
                }
            }
        }

        for computer in computers.iter().filter_map(ComputerRecord::healthy) {
            let named: Vec<&SubscriptionItemId> = observed
                .items
                .iter()
                .filter(|item| item.computer_id == Some(computer.id))
                .map(|item| &item.subscription_item)
                .collect();
            let billed_item = computer.subscription_item();
            // The item the computer keeps: the one it is billed on, else the
            // first naming it. Every other item naming it bills nothing of ours.
            let kept = billed_item
                .and_then(|billed| named.iter().copied().find(|item| *item == billed))
                .or_else(|| billed_item.and(named.first().copied()));
            let strays: Vec<&SubscriptionItemId> = named
                .iter()
                .copied()
                .filter(|item| Some(*item) != kept)
                .collect();
            if !ended
                && !strays.is_empty()
                && let Err(error) = self
                    .remove_strays(team_id, computer.id, &strays, observed_at)
                    .await
            {
                first_error.get_or_insert(error);
            }
            let Some(billed_item) = billed_item else {
                continue;
            };
            let mut events = Vec::new();
            match kept {
                _ if ended => events.push(Event::BillingItemMissing { observed_at }),
                None => events.push(Event::BillingItemMissing { observed_at }),
                Some(item) => {
                    if item != billed_item {
                        events.push(Event::BillingItemMoved {
                            subscription_item: item.clone(),
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
                if let Err(error) = self.apply(computer.id, event).await {
                    first_error.get_or_insert(error);
                    break;
                }
            }
        }
        tracing::debug!(current_period_end = %observed.current_period_end, "subscription observed");
        first_error.map_or(Ok(()), Err)
    }

    /// Remove items naming `computer_id` that it is not billed on, deciding
    /// under its billing guard against its current state: a snapshot older
    /// than the computer's last billing change (an undo or restore that just
    /// re-added an item) removes nothing.
    async fn remove_strays(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        strays: &[&SubscriptionItemId],
        observed_at: DateTime<Utc>,
    ) -> Result<(), ComputerError> {
        let _billing = self
            .repo
            .lock_billing(computer_id)
            .await
            .map_err(internal)?;
        let Some(record) = self.repo.get(computer_id).await.map_err(internal)? else {
            return Ok(());
        };
        let Some(computer) = record.healthy() else {
            return Ok(());
        };
        // A charge still settling may just have added this item; its effect decides.
        if computer.state.billing_changed_at > observed_at
            || computer.state.billing == ComputerBilling::Charging
        {
            return Ok(());
        }
        let mut strays = strays.to_vec();
        // An undo or restore whose charge went through but whose event never
        // applied (the request was dropped) left its item here: finish that
        // request instead of stripping what the team just paid for.
        if computer.subscription_item().is_none()
            && let Some(item) = strays.first().copied()
        {
            match self.readd_charge(computer).await? {
                Some((_, ChargeStatus::Pending)) => {
                    // Its outcome isn't known yet; a later snapshot decides.
                    return Ok(());
                }
                Some((intent, ChargeStatus::Applied)) => {
                    let event = match intent {
                        Readd::UndoCancel => Event::UndoCancel {
                            subscription_item: item.clone(),
                        },
                        Readd::Restore => Event::Restore {
                            billing: ComputerBilling::Active {
                                subscription_item: item.clone(),
                            },
                        },
                    };
                    if let Some(Applied::Changed(_)) = self
                        .repo
                        .apply(computer_id, event, self.clock.now())
                        .await
                        .map_err(internal)?
                    {
                        tracing::info!(computer_id = %computer_id, subscription_item = %item,
                            ?intent, "finished a paid undo or restore from its subscription item");
                        strays.retain(|stray| *stray != item);
                    }
                }
                Some((_, ChargeStatus::NotApplied)) | None => {}
            }
        }
        for item in strays {
            if computer.subscription_item() == Some(item) {
                continue;
            }
            tracing::warn!(computer_id = %computer_id, subscription_item = %item,
                "removing a subscription item the computer is not billed on");
            self.billing
                .remove_computer(team_id, item, &stray_key(item, observed_at))
                .await?;
        }
        Ok(())
    }

    /// The current cancellation's latest undo or restore charge that may have
    /// reached the subscription, and where it stands.
    async fn readd_charge(
        &self,
        computer: &crate::domain::models::Computer,
    ) -> Result<Option<(Readd, ChargeStatus)>, ComputerError> {
        for intent in [Readd::UndoCancel, Readd::Restore] {
            for attempt in 0..MAX_READD_ATTEMPTS {
                match self
                    .billing
                    .charge_status(&readd_key(computer, intent.purpose(), attempt))
                    .await?
                {
                    None => break,
                    Some(ChargeStatus::NotApplied) => {}
                    Some(status) => return Ok(Some((intent, status))),
                }
            }
        }
        Ok(None)
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
            let effect_id = pending.id;
            // One effect's storage failure never stops the batch or the
            // purchase confirmation below; its lease expires and it runs again.
            match self.run_billing_effect(pending, now).await {
                Ok(()) => {}
                Err(error) if error.is_storage_unavailable() => {
                    tracing::warn!(
                        effect_id,
                        "computer storage unavailable; billing effect retried later"
                    );
                }
                Err(error) => {
                    tracing::error!(effect_id, error = ?error, "billing effect could not be recorded");
                }
            }
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
        async {
            // A charge is never abandoned: it settles for good on its last
            // attempt, and until that answers the computer stays unpaid.
            let abandonable = !matches!(pending.effect, Effect::Charge { .. });
            let done = match &pending.effect {
                Effect::Charge {
                    price_id,
                    extra_items,
                } => self.charge_claimed(&pending, price_id, extra_items).await,
                _ => self.remove_billing_item(&pending).await,
            };
            // Every failure, reading the computer included, is retried with
            // backoff and counts toward the abandonment alert.
            match done {
                Ok(()) => self
                    .repo
                    .complete_effect(pending.id)
                    .await
                    .map_err(internal),
                // Not the removal's failure: it runs again once its lease
                // expires, without spending an attempt.
                Err(error) if error.is_storage_unavailable() => Err(error),
                Err(error) => {
                    super::super::telemetry::effect_failed("billing");
                    tracing::Span::current().record("otel.status_code", "ERROR");
                    let attempts = pending.attempts.saturating_add(1);
                    if abandonable && attempts >= MAX_BILLING_ATTEMPTS {
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

    /// Charge a pool computer a purchase took, under its billing guard, with
    /// the purchase's one idempotency key ([`crate::domain::models::charge_key`]),
    /// so a retry replays the same change. The charge reaching the
    /// subscription bills the computer on its item; a definite refusal
    /// releases it (nothing was charged). From [`MAX_BILLING_ATTEMPTS`] on,
    /// the add is settled for good instead of replayed: an item that reached
    /// the subscription bills the computer, none releases it.
    async fn charge_claimed(
        &self,
        pending: &PendingEffect,
        price_id: &stripe::PriceId,
        extra_items: &[crate::domain::models::SubscriptionItem],
    ) -> Result<(), ComputerError> {
        let _billing = self
            .repo
            .lock_billing(pending.computer_id)
            .await
            .map_err(internal)?;
        let computer = self
            .repo
            .get(pending.computer_id)
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?
            .into_healthy()
            .map_err(|_| ComputerError::NeedsAttention)?;
        super::super::telemetry::adopt(&tracing::Span::current(), &computer.state);
        let Some(team_id) = computer.team_id() else {
            return Err(ComputerError::Internal(rootcause::report!(
                "a pool computer has no purchase to charge"
            )));
        };
        let key = crate::domain::models::charge_key(computer.id);

        let outcome = if pending.attempts.saturating_add(1) >= MAX_BILLING_ATTEMPTS {
            self.billing
                .settle_computer_add(team_id, computer.id, &key)
                .await
        } else {
            self.billing
                .add_computer(
                    team_id,
                    computer.id,
                    price_id,
                    extra_items,
                    ItemCharge::Prorated,
                    &key,
                )
                .await
                .map(Some)
        };
        let event = match outcome {
            Ok(Some(subscription_item)) => Event::ChargeSucceeded { subscription_item },
            Ok(None) => {
                tracing::warn!(computer_id = %computer.id,
                    "computer charge settled uncharged; releasing the computer");
                Event::ChargeFailed
            }
            Err(error) if error.is_definite() => {
                tracing::warn!(computer_id = %computer.id, error = ?error,
                    "computer charge refused; releasing the computer");
                Event::ChargeFailed
            }
            Err(error) => return Err(error.into()),
        };
        self.apply(computer.id, event).await?;
        Ok(())
    }

    /// Remove the effect's item, deciding under the computer's billing guard
    /// against its billing as it is now: an undo or restore may have taken
    /// the item back since the removal was queued. A quarantined computer's
    /// removal still runs, since the effect names the item and a removal
    /// never bills anyone.
    async fn remove_billing_item(&self, pending: &PendingEffect) -> Result<(), ComputerError> {
        let Effect::RemoveBillingItem { subscription_item } = &pending.effect else {
            return Err(ComputerError::Internal(rootcause::report!(
                "a fleet effect reached the billing worker"
            )));
        };
        let _billing = self
            .repo
            .lock_billing(pending.computer_id)
            .await
            .map_err(internal)?;
        let record = self
            .repo
            .get(pending.computer_id)
            .await
            .map_err(internal)?
            .ok_or(ComputerError::NotFound)?;
        if let Some(computer) = record.healthy() {
            super::super::telemetry::adopt(&tracing::Span::current(), &computer.state);
            if computer.subscription_item() == Some(subscription_item) {
                tracing::info!(subscription_item = %subscription_item,
                    "the computer is billed on this item again; not removing it");
                return Ok(());
            }
        }
        let Some(key) = self.removal_key(pending.id).await? else {
            tracing::info!(subscription_item = %subscription_item,
                "an earlier attempt removed this item");
            return Ok(());
        };
        let Some(team_id) = record.team_id() else {
            return Err(ComputerError::Internal(rootcause::report!(
                "a pool computer has no billing item to remove"
            )));
        };
        match self
            .billing
            .remove_computer(team_id, subscription_item, &key)
            .await
        {
            // A subscription that is gone took the item with it.
            Ok(()) | Err(BillingError::NoSubscription) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    /// The key a billing effect's removal is sent under: the same one on
    /// every retry, so a retry replays its own change (which the
    /// subscription guard lets through) instead of being refused by it. A
    /// generation whose change definitely did not apply (given up while its
    /// outcome was unknown) is spent, and the next one is used. `None` when
    /// a generation already removed the item.
    async fn removal_key(&self, effect_id: i64) -> Result<Option<String>, ComputerError> {
        for generation in 0..MAX_BILLING_ATTEMPTS {
            let key = removal_key(effect_id, generation);
            match self.billing.charge_status(&key).await? {
                Some(ChargeStatus::NotApplied) => continue,
                Some(ChargeStatus::Applied) => return Ok(None),
                None | Some(ChargeStatus::Pending) => return Ok(Some(key)),
            }
        }
        Err(ComputerError::Internal(rootcause::report!(
            "every removal of this billing item was given up"
        )))
    }
}
