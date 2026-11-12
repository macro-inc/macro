//! Receives verified events and applies them, per consumer and customer, in
//! order.

use std::sync::Arc;

use chrono::Utc;
use futures::future::join_all;
use stripe::{CustomerId, SubscriptionId};
use tracing::Instrument;
use uuid::Uuid;

use super::model::{
    ApplyError, ApplyOutcome, BillingInboxEvent, ClaimedCursor, Consumer, Delivery, ObjectKind,
    ObjectSnapshot, OrderingKey, StoredEvent, SubscriptionFacts,
};
use super::ports::{
    CursorFailure, CursorWake, EventConsumers, InboxRepo, Inserted, Replayed, StripeReadError,
    StripeReader,
};
use super::translate::{self, TranslateError, Translated};

#[cfg(test)]
mod test;

/// Cursors leased per pass; also how many apply concurrently per replica.
pub const CLAIM_BATCH: u32 = 8;
/// How long a lease hides a cursor from other replicas; every applied event
/// extends it.
pub const LEASE: chrono::Duration = chrono::Duration::seconds(60);
/// Events loaded per query while a cursor is leased.
const EVENT_PAGE: u32 = 100;
/// Failed attempts after which a cursor is dead-lettered: about six hours
/// of backoff, so an outage of a dependency is retried through.
pub const MAX_ATTEMPTS: u32 = 15;
/// The first retry delay; it doubles per attempt.
const BASE_BACKOFF: chrono::Duration = chrono::Duration::seconds(5);
/// The longest retry delay.
const MAX_BACKOFF: chrono::Duration = chrono::Duration::hours(1);
/// Queue delay past which an apply logs `stripe inbox backlog`.
const BACKLOG_ALERT: chrono::Duration = chrono::Duration::minutes(5);

/// Why a webhook body was refused.
#[derive(Debug, thiserror::Error)]
pub enum ReceiveError {
    /// The verified body could not be parsed.
    #[error(transparent)]
    Invalid(#[from] TranslateError),
    /// A test-mode event reached a live deployment, or the reverse.
    #[error("event livemode does not match this environment")]
    WrongMode,
    /// Storing failed; Stripe should retry.
    #[error("could not store the event: {0}")]
    Storage(rootcause::Report),
}

/// What one worker pass did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PassReport {
    /// Cursors leased.
    pub claimed: usize,
}

/// The inbox: receive, and apply.
pub struct InboxService<Repo, Reader, Consumers> {
    repo: Repo,
    reader: Arc<Reader>,
    consumers: Arc<Consumers>,
    replica: Uuid,
    livemode: bool,
}

impl<Repo, Reader, Consumers> InboxService<Repo, Reader, Consumers>
where
    Repo: InboxRepo,
    Reader: StripeReader,
    Consumers: EventConsumers,
{
    /// An inbox for a live (`livemode`) or test deployment.
    pub fn new(repo: Repo, reader: Arc<Reader>, consumers: Arc<Consumers>, livemode: bool) -> Self {
        Self {
            repo,
            reader,
            consumers,
            replica: Uuid::now_v7(),
            livemode,
        }
    }

    /// Stores a verified webhook body and marks its consumers due. Does no
    /// domain work and calls no API, so the webhook answers at once.
    #[tracing::instrument(
        name = "stripe.webhook.receive",
        skip_all,
        fields(event_id, event_type, customer_id, duplicate),
        err
    )]
    pub async fn receive(&self, payload: &str) -> Result<Inserted, ReceiveError> {
        let event = translate::received_event(payload)?;
        let span = tracing::Span::current();
        span.record("event_id", event.id.as_str());
        span.record("event_type", event.type_name.as_str());
        span.record("customer_id", event.ordering_key.0.as_str());
        if event.livemode != self.livemode {
            return Err(ReceiveError::WrongMode);
        }

        let wakes: Vec<CursorWake> = match event.event_type() {
            Some(event_type) => event_type
                .consumers()
                .into_iter()
                .map(|consumer| CursorWake {
                    consumer,
                    due_at: Utc::now(),
                })
                .collect(),
            None => {
                tracing::info!("stored a stripe event type no consumer applies");
                Vec::new()
            }
        };
        let traceparent = crate::telemetry::traceparent();
        let inserted = self
            .repo
            .insert(&event, &wakes, traceparent.as_deref())
            .await
            .map_err(|error| ReceiveError::Storage(rootcause::Report::new(error).into_dynamic()))?;
        span.record("duplicate", inserted == Inserted::Duplicate);
        Ok(inserted)
    }

    /// Leases due cursors and applies their events, concurrently across
    /// cursors and in order within each.
    pub async fn run_pass(&self) -> Result<PassReport, rootcause::Report> {
        let cursors = self
            .repo
            .claim(self.replica, CLAIM_BATCH, LEASE)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())?;
        let claimed = cursors.len();
        join_all(cursors.into_iter().map(|cursor| self.drain(cursor))).await;
        Ok(PassReport { claimed })
    }

    /// Makes a cursor due again (an operator's replay).
    pub async fn replay(
        &self,
        consumer: Consumer,
        key: &OrderingKey,
        skip_dead_event: bool,
    ) -> Result<Replayed, rootcause::Report> {
        self.repo
            .replay(consumer, key, skip_dead_event)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())
    }

    /// Applies one leased cursor's pending events until it is caught up or
    /// one fails. Storage errors leave the lease to expire, so another pass
    /// retries.
    async fn drain(&self, cursor: ClaimedCursor) {
        if let Err(error) = self.drain_cursor(cursor.clone()).await {
            tracing::error!(
                consumer = %cursor.consumer,
                customer_id = %cursor.key,
                error = ?error,
                "stripe inbox cursor pass failed"
            );
        }
    }

    async fn drain_cursor(&self, mut cursor: ClaimedCursor) -> Result<(), Repo::Err> {
        loop {
            let events = self
                .repo
                .pending_events(
                    cursor.consumer,
                    &cursor.key,
                    cursor.applied.as_ref(),
                    EVENT_PAGE,
                )
                .await?;
            let page_full = u32::try_from(events.len()).is_ok_and(|count| count >= EVENT_PAGE);

            for event in events {
                let span = tracing::info_span!(
                    "stripe_inbox.apply",
                    consumer = %cursor.consumer,
                    customer_id = %cursor.key,
                    event_id = %event.id,
                    event_type = %event.event_type,
                    queue_delay_ms = (Utc::now() - event.received_at).num_milliseconds(),
                    attempt = cursor.attempts + 1,
                    outcome = tracing::field::Empty,
                );
                crate::telemetry::link(&span, event.traceparent.as_deref());
                let result = self
                    .apply(cursor.consumer, &event)
                    .instrument(span.clone())
                    .await;

                let position = event.position();
                match result {
                    Ok(outcome) => {
                        span.record("outcome", outcome.as_ref());
                        if Utc::now() - event.received_at > BACKLOG_ALERT {
                            tracing::warn!(
                                parent: &span,
                                consumer = %cursor.consumer,
                                "stripe inbox backlog"
                            );
                        }
                        if !self
                            .repo
                            .advance(&cursor, self.replica, &position, LEASE)
                            .await?
                        {
                            tracing::warn!(parent: &span, "stripe inbox lease lost");
                            return Ok(());
                        }
                        cursor.applied = Some(position);
                        cursor.attempts = 0;
                    }
                    Err(error) => {
                        let failure = self.failure(&cursor, &event, &error);
                        let outcome = if failure.dead_event.is_some() {
                            tracing::error!(
                                parent: &span,
                                consumer = %cursor.consumer,
                                customer_id = %cursor.key,
                                event_id = %event.id,
                                attempts = failure.attempts,
                                error = %error,
                                "stripe inbox cursor dead-lettered"
                            );
                            ApplyOutcome::DeadLettered
                        } else {
                            tracing::warn!(
                                parent: &span,
                                attempts = failure.attempts,
                                error = %error,
                                "stripe inbox apply failed; will retry"
                            );
                            ApplyOutcome::Failed
                        };
                        span.record("outcome", outcome.as_ref());
                        self.repo.fail(&cursor, self.replica, &failure).await?;
                        return Ok(());
                    }
                }
            }

            if !page_full {
                self.repo.release(&cursor, self.replica).await?;
                return Ok(());
            }
        }
    }

    fn failure(
        &self,
        cursor: &ClaimedCursor,
        event: &StoredEvent,
        error: &ApplyError,
    ) -> CursorFailure {
        let attempts = cursor.attempts + 1;
        let dead = match error {
            ApplyError::Reject(_) => true,
            ApplyError::Retry(_) => attempts >= MAX_ATTEMPTS,
        };
        CursorFailure {
            attempts,
            next_attempt_at: Utc::now() + backoff(attempts),
            error: error.to_string(),
            dead_event: dead.then(|| event.id.clone()),
        }
    }

    /// Translates one event, settles what the consumer needs to know, and
    /// hands it over.
    async fn apply(
        &self,
        consumer: Consumer,
        event: &StoredEvent,
    ) -> Result<ApplyOutcome, ApplyError> {
        let payload = event.payload.as_ref().ok_or_else(|| {
            ApplyError::Reject(rootcause::report!("the event's payload passed retention"))
        })?;
        let translated = translate::translate(event.event_type, payload).map_err(reject)?;
        let position = event.position();

        let (event_body, customer) = match translated {
            Translated::Subscription(mut change) => {
                if consumer.acts_on_latest_snapshot()
                    && self
                        .repo
                        .newer_snapshot_received(&event.object_id, &position)
                        .await
                        .map_err(retry)?
                {
                    return Ok(ApplyOutcome::Skipped);
                }
                if consumer.needs_every_item() && !change.subscription.items_complete {
                    self.fill_items(&mut change.subscription).await?;
                }
                let customer = change.subscription.customer.clone();
                (BillingInboxEvent::Subscription(change), Some(customer))
            }
            Translated::Invoice(invoice) => {
                // `invoice.paid` and `invoice.payment_succeeded` are one fact,
                // and a failure reported after the payment changes nothing.
                if self
                    .repo
                    .invoice_paid_before(invoice.id.as_str(), &position)
                    .await
                    .map_err(retry)?
                {
                    return Ok(ApplyOutcome::Skipped);
                }
                // A subscription's invoice reaches only consumers of those;
                // the others act on Macro's own one-off invoices.
                let subscription = match &invoice.subscription {
                    Some(_) if !consumer.reads_invoice_subscription() => {
                        return Ok(ApplyOutcome::Skipped);
                    }
                    Some(id) => Some(self.subscription(id).await?),
                    None => None,
                };
                let customer = invoice.customer.clone();
                (
                    BillingInboxEvent::Invoice {
                        invoice,
                        subscription,
                    },
                    customer,
                )
            }
            Translated::Checkout(checkout) => (BillingInboxEvent::Checkout(checkout), None),
            Translated::Customer => return Ok(ApplyOutcome::Skipped),
        };

        let customer_subscriptions = match (consumer.reads_customer_subscriptions(), customer) {
            (true, Some(customer)) => self.customer_subscriptions(&customer).await?,
            _ => Vec::new(),
        };
        let delivery = Delivery {
            event_id: event.id.clone(),
            created_at: event.created_at,
            event: event_body,
            customer_subscriptions,
        };
        self.consumers.apply(consumer, &delivery).await?;
        Ok(ApplyOutcome::Applied)
    }

    /// Pages the items a snapshot left out (it carries at most ten).
    async fn fill_items(&self, subscription: &mut SubscriptionFacts) -> Result<(), ApplyError> {
        let items = self
            .reader
            .subscription_items(&subscription.id)
            .await
            .map_err(read_failed)?;
        let fallback_period = subscription.items.iter().find_map(|item| item.period);
        subscription.items =
            translate::subscription_items(&items, fallback_period).map_err(reject)?;
        subscription.items_complete = true;
        Ok(())
    }

    /// The newest snapshot held of a subscription, read from Stripe once
    /// when none is held (an invoice before any subscription event).
    async fn subscription(&self, id: &SubscriptionId) -> Result<SubscriptionFacts, ApplyError> {
        if let Some(snapshot) = self.repo.subscription_snapshot(id).await.map_err(retry)? {
            return translate::subscription_facts(&snapshot).map_err(reject);
        }
        let read_at = Utc::now();
        let snapshot = self
            .reader
            .retrieve_subscription(id)
            .await
            .map_err(read_failed)?;
        let facts = translate::subscription_facts(&snapshot).map_err(reject)?;
        self.repo
            .store_read(
                &[ObjectSnapshot {
                    id: facts.id.to_string(),
                    kind: ObjectKind::Subscription,
                    customer: Some(facts.customer.to_string()),
                    snapshot,
                    deleted: false,
                }],
                read_at,
                None,
            )
            .await
            .map_err(retry)?;
        Ok(facts)
    }

    /// Every subscription of `customer`, listed from Stripe once per
    /// customer so subscriptions older than the inbox are held too.
    async fn customer_subscriptions(
        &self,
        customer: &CustomerId,
    ) -> Result<Vec<SubscriptionFacts>, ApplyError> {
        let held = match self
            .repo
            .customer_subscriptions(customer)
            .await
            .map_err(retry)?
        {
            Some(held) => held,
            None => {
                let read_at = Utc::now();
                let listed = self
                    .reader
                    .customer_subscriptions(customer)
                    .await
                    .map_err(read_failed)?;
                let snapshots = listed
                    .into_iter()
                    .map(|snapshot| {
                        let facts = translate::subscription_facts(&snapshot)?;
                        Ok(ObjectSnapshot {
                            id: facts.id.to_string(),
                            kind: ObjectKind::Subscription,
                            customer: Some(facts.customer.to_string()),
                            snapshot,
                            deleted: false,
                        })
                    })
                    .collect::<Result<Vec<_>, TranslateError>>()
                    .map_err(reject)?;
                self.repo
                    .store_read(&snapshots, read_at, Some(customer))
                    .await
                    .map_err(retry)?;
                self.repo
                    .customer_subscriptions(customer)
                    .await
                    .map_err(retry)?
                    .unwrap_or_default()
            }
        };
        held.iter()
            .map(translate::subscription_facts)
            .collect::<Result<Vec<_>, _>>()
            .map_err(reject)
    }
}

/// Exponential backoff from five seconds, capped at an hour, with up to a
/// fifth of jitter so retries of one burst spread out.
pub fn backoff(attempts: u32) -> chrono::Duration {
    let doubling = attempts.saturating_sub(1).min(16);
    let delay = BASE_BACKOFF
        .checked_mul(1 << doubling)
        .unwrap_or(MAX_BACKOFF)
        .min(MAX_BACKOFF);
    let jitter_ms = delay.num_milliseconds() / 5;
    let jitter = if jitter_ms > 0 {
        chrono::Duration::milliseconds(rand::random_range(0..=jitter_ms))
    } else {
        chrono::Duration::zero()
    };
    delay + jitter
}

fn reject(error: TranslateError) -> ApplyError {
    ApplyError::Reject(rootcause::Report::new(error).into_dynamic())
}

fn retry(error: impl std::error::Error + Send + Sync + 'static) -> ApplyError {
    ApplyError::Retry(rootcause::Report::new(error).into_dynamic())
}

fn read_failed(error: StripeReadError) -> ApplyError {
    if matches!(error, StripeReadError::RateLimited) {
        tracing::warn!("stripe inbox rate limited");
    }
    ApplyError::Retry(rootcause::Report::new(error).into_dynamic())
}
