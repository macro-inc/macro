//! Push notifications are authenticated hints for the durable sync journal.

use super::*;
use chrono::{DateTime, Duration, Utc};
use email_api_client::domain::models::{MailboxSubscription, MailboxWatchDetails};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use subtle::ConstantTimeEq;
use tracing::{Instrument, Span};

/// Live messages a mailbox may have due before a notification queues
/// another read: past that, its folders' pages list the rest. Message claims
/// take live work first in arrival order across mailboxes, so this is how far
/// one busy mailbox's notifications can put other mailboxes' new mail, and
/// every import, behind its own.
const NOTIFIED_READS_AHEAD: u32 = 50;

/// Turns on reading the message a change notification names as soon as the
/// webhook accepts it. The host sets it from its feature flag; off, a
/// notification only wakes the mailbox's folders, as before.
#[derive(Debug, Clone, Default)]
pub struct NotifiedMessageReads(Arc<AtomicBool>);

impl NotifiedMessageReads {
    pub fn enabled(&self) -> bool {
        self.0.load(Ordering::Relaxed)
    }

    /// Returns whether it was on before.
    pub fn set(&self, enabled: bool) -> bool {
        self.0.swap(enabled, Ordering::Relaxed)
    }
}

/// What accepting a notification did.
pub struct NotificationAccepted {
    pub link_id: Uuid,
    /// Whether the message it names was queued for a read.
    pub message_queued: bool,
}

pub struct WatchLease {
    pub mailbox: MailboxKey,
    pub lease_id: Uuid,
    pub revision: i64,
    /// Upkeep runs in a row that failed before this one.
    pub failures: i32,
}
pub struct WatchAttempt {
    pub id: Uuid,
    pub generation: i64,
    pub provider_id: Option<ProviderId>,
    pub verifier: Vec<u8>,
    pub expires_at: DateTime<Utc>,
}
pub enum WatchHint {
    Changed,
    Missed,
    Removed,
    Reauthorize,
}
impl WatchHint {
    /// Graph's name for a lifecycle event; a change notification has none.
    fn lifecycle_event(&self) -> Option<&'static str> {
        match self {
            Self::Changed => None,
            Self::Missed => Some("missed"),
            Self::Removed => Some("subscriptionRemoved"),
            Self::Reauthorize => Some("reauthorizationRequired"),
        }
    }
}
pub struct WatchNotification {
    pub subscription_id: String,
    pub client_state: String,
    pub hint: WatchHint,
    /// The message a change notification names (`resourceData.id`, an
    /// immutable id like the ones folder pages list).
    pub message: Option<ProviderId>,
}

pub trait MailboxWatchRepository: Send + Sync + 'static {
    fn claim_watch(
        &self,
        lease: Uuid,
    ) -> impl Future<Output = Result<Option<WatchLease>, MailboxError>> + Send;
    fn renew_watch_lease(
        &self,
        lease: &WatchLease,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn watch_attempts(
        &self,
        lease: &WatchLease,
    ) -> impl Future<Output = Result<Vec<WatchAttempt>, MailboxError>> + Send;
    fn reserve_watch(
        &self,
        lease: &WatchLease,
        id: Uuid,
        verifier: &[u8],
        expires: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn bind_watch(
        &self,
        lease: &WatchLease,
        id: Uuid,
        subscription: &MailboxSubscription,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn forget_watch(
        &self,
        lease: &WatchLease,
        id: Uuid,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    /// Puts the upkeep back for `delay` seconds with `failures` failed runs
    /// in a row. A revision bump during the lease (a reconnect, a lifecycle
    /// event) makes it due at once with none.
    fn release_watch(
        &self,
        lease: &WatchLease,
        delay: u32,
        failures: i32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn notification_binding(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<WatchAttempt>, MailboxError>> + Send;
    /// Wakes the mailbox the notification is for, or answers `None` when the
    /// subscription no longer belongs to a syncing mailbox. With `message`,
    /// it also queues that message as live work, in the same transaction,
    /// unless a folder of the mailbox is still in its import round or the
    /// mailbox already has `queued_ahead` live messages due.
    fn accept_notification(
        &self,
        id: Uuid,
        expected: &WatchAttempt,
        subscription: &str,
        hint: &WatchHint,
        message: Option<&ProviderId>,
        queued_ahead: u32,
    ) -> impl Future<Output = Result<Option<NotificationAccepted>, MailboxError>> + Send;
}
pub trait MailboxWatchGateway: Send + Sync + 'static {
    fn watches(
        &self,
        key: MailboxKey,
    ) -> impl Future<Output = Result<Vec<MailboxWatchDetails>, EmailApiError>> + Send;
    fn create_watch(
        &self,
        key: MailboxKey,
        url: &str,
        state: &str,
        expires: DateTime<Utc>,
    ) -> impl Future<Output = Result<MailboxSubscription, EmailApiError>> + Send;
    fn renew_watch(
        &self,
        key: MailboxKey,
        id: &ProviderId,
        expires: DateTime<Utc>,
    ) -> impl Future<Output = Result<MailboxSubscription, EmailApiError>> + Send;
    fn remove_watch(
        &self,
        key: MailboxKey,
        id: &ProviderId,
    ) -> impl Future<Output = Result<(), EmailApiError>> + Send;
}
pub struct MailboxWatchNotifications<R> {
    repository: R,
    message_reads: NotifiedMessageReads,
}
impl<R> MailboxWatchNotifications<R> {
    pub fn new(repository: R) -> Self {
        Self {
            repository,
            message_reads: NotifiedMessageReads::default(),
        }
    }

    pub fn with_message_reads(mut self, switch: NotifiedMessageReads) -> Self {
        self.message_reads = switch;
        self
    }
}
impl<R: MailboxWatchRepository> MailboxWatchNotifications<R> {
    /// Accepts one webhook delivery for the subscription attempt `id`. Each
    /// lifecycle event is logged, since a dropped (`missed`) or expiring
    /// subscription leaves the mailbox on polling alone.
    pub async fn receive(
        &self,
        id: Uuid,
        notifications: Vec<WatchNotification>,
    ) -> Result<(), MailboxError> {
        let span = tracing::info_span!(
            "outlook.subscription.notify",
            outlook.subscription_attempt = %id,
            mailbox.link_id = tracing::field::Empty,
            outlook.notifications = super::telemetry::span_int(notifications.len()),
            outlook.notifications_accepted = tracing::field::Empty,
            outlook.lifecycle_events = tracing::field::Empty,
            outlook.messages_queued = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        let mut counts = AcceptCounts::default();
        let result = self
            .accept(id, notifications, &mut counts)
            .instrument(span.clone())
            .await;
        span.record("outlook.notifications_accepted", counts.accepted);
        span.record("outlook.lifecycle_events", counts.lifecycle_events);
        span.record("outlook.messages_queued", counts.messages_queued);
        result.inspect_err(|error| {
            span.record("otel.status_description", tracing::field::display(error));
        })
    }

    async fn accept(
        &self,
        id: Uuid,
        notifications: Vec<WatchNotification>,
        counts: &mut AcceptCounts,
    ) -> Result<(), MailboxError> {
        let span = Span::current();
        let Some(binding) = self.repository.notification_binding(id).await? else {
            return Ok(());
        };
        for notification in notifications {
            let hash = Sha256::digest(notification.client_state.as_bytes());
            if hash[..].ct_eq(&binding.verifier).unwrap_u8() != 1
                || binding
                    .provider_id
                    .as_ref()
                    .is_some_and(|p| p.as_str() != notification.subscription_id)
            {
                continue;
            }
            // Only a change notification names a message.
            let message = notification.message.as_ref().filter(|_| {
                self.message_reads.enabled() && matches!(notification.hint, WatchHint::Changed)
            });
            let Some(NotificationAccepted {
                link_id,
                message_queued,
            }) = self
                .repository
                .accept_notification(
                    id,
                    &binding,
                    &notification.subscription_id,
                    &notification.hint,
                    message,
                    NOTIFIED_READS_AHEAD,
                )
                .await?
            else {
                continue;
            };
            counts.accepted += 1;
            counts.messages_queued += i64::from(message_queued);
            span.record("mailbox.link_id", tracing::field::display(link_id));
            if let Some(event) = notification.hint.lifecycle_event() {
                counts.lifecycle_events += 1;
                if matches!(notification.hint, WatchHint::Missed) {
                    tracing::warn!(%link_id, lifecycle_event = event, "outlook subscription lifecycle event");
                } else {
                    tracing::info!(%link_id, lifecycle_event = event, "outlook subscription lifecycle event");
                }
            }
        }
        Ok(())
    }
}
/// What one webhook delivery did, for its span.
#[derive(Default)]
struct AcceptCounts {
    accepted: i64,
    lifecycle_events: i64,
    messages_queued: i64,
}
pub struct MailboxWatchService<R, G> {
    repository: R,
    gateway: G,
    callback_base: String,
}
impl<R, G> MailboxWatchService<R, G> {
    pub fn new(repository: R, gateway: G, callback_base: String) -> Self {
        Self {
            repository,
            gateway,
            callback_base: callback_base.trim_end_matches('/').to_owned(),
        }
    }
    fn callback(&self, id: Uuid) -> String {
        format!("{}/outlook/webhook/{id}", self.callback_base)
    }
}
impl<R: MailboxWatchRepository, G: MailboxWatchGateway> MailboxWatchService<R, G> {
    pub async fn execute_once(&self) -> Result<bool, MailboxError> {
        // A local development stack requires a reachable HTTPS tunnel. Polling
        // remains active while that callback address is not configured.
        if !self.callback_base.starts_with("https://") {
            return Ok(false);
        }
        let Some(lease) = self
            .repository
            .claim_watch(Uuid::new_v4())
            .await
            .map_err(|error| super::telemetry::claim_failed("watches", error))?
        else {
            return Ok(false);
        };
        let link_id = lease.mailbox.link_id;
        let span = tracing::info_span!(
            "outlook.subscription.maintain",
            mailbox.link_id = %link_id,
            mailbox.sync_generation = lease.mailbox.sync_generation,
            outlook.subscription_action = tracing::field::Empty,
            outlook.subscription_expires_at = tracing::field::Empty,
            outlook.subscriptions_removed = tracing::field::Empty,
            outlook.outcome = tracing::field::Empty,
            outlook.defer_reason = tracing::field::Empty,
            outlook.defer_seconds = tracing::field::Empty,
            outlook.upkeep_failures = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        async {
            let mut removed = 0i64;
            let result = super::maintain_lease(self.execute(&lease, &mut removed), || {
                self.repository.renew_watch_lease(&lease)
            })
            .await;
            span.record("outlook.subscriptions_removed", removed);
            let (delay, failures) = match &result {
                Ok(()) => (UPKEEP_SECONDS, 0),
                Err(error) => upkeep_retry(error, lease.failures),
            };
            span.record("outlook.upkeep_failures", i64::from(failures));
            self.repository
                .release_watch(&lease, delay, failures)
                .await?;
            match &result {
                Ok(()) => span.record("outlook.outcome", "done"),
                Err(error) => {
                    // Until it runs again the mailbox may receive no
                    // notifications, so a failed renewal is a span error.
                    span.record("outlook.outcome", "deferred");
                    span.record(
                        "outlook.defer_reason",
                        super::telemetry::defer_reason(error),
                    );
                    span.record("outlook.defer_seconds", i64::from(delay));
                    span.record("otel.status_description", tracing::field::display(error))
                }
            };
            result.map(|()| true)
        }
        .instrument(span.clone())
        .await
        .inspect_err(|error| super::telemetry::log_unit_error(link_id, error))
    }
    async fn execute(&self, lease: &WatchLease, removed: &mut i64) -> Result<(), MailboxError> {
        let span = Span::current();
        let remote = self.gateway.watches(lease.mailbox).await?;
        let attempts = self.repository.watch_attempts(lease).await?;
        let mut keep = None;
        for attempt in attempts {
            let callback = self.callback(attempt.id);
            let found = remote.iter().find(|r| {
                r.notification_url == callback
                    && r.lifecycle_url.as_deref() == Some(callback.as_str())
            });
            let Some(found) = found else {
                // Retain unknown attempts until their requested lifetime ends;
                // a timed-out create may still appear on the next listing.
                if attempt.provider_id.is_some() || attempt.expires_at < Utc::now() {
                    self.repository.forget_watch(lease, attempt.id).await?;
                }
                continue;
            };
            self.repository
                .bind_watch(lease, attempt.id, &found.subscription)
                .await?;
            if attempt.generation == lease.mailbox.sync_generation
                && keep.is_none()
                && found.subscription.expires_at > Utc::now()
            {
                keep = Some((attempt.id, found.subscription.id.clone()));
            } else {
                self.repository.renew_watch_lease(lease).await?;
                self.gateway
                    .remove_watch(lease.mailbox, &found.subscription.id)
                    .await?;
                self.repository.forget_watch(lease, attempt.id).await?;
                *removed += 1;
            }
        }
        let expires = Utc::now() + Duration::days(3);
        if let Some((id, provider_id)) = keep {
            match self
                .gateway
                .renew_watch(lease.mailbox, &provider_id, expires)
                .await
            {
                Ok(subscription) => {
                    record_subscription(&span, "renewed", &subscription);
                    return self.repository.bind_watch(lease, id, &subscription).await;
                }
                Err(EmailApiError::NotFound) => self.repository.forget_watch(lease, id).await?,
                Err(error) => {
                    span.record("outlook.subscription_action", "renew");
                    return Err(error.into());
                }
            }
        }
        let id = Uuid::new_v4();
        let state = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let verifier = Sha256::digest(state.as_bytes());
        self.repository
            .reserve_watch(lease, id, &verifier, expires)
            .await?;
        span.record("outlook.subscription_action", "create");
        let subscription = self
            .gateway
            .create_watch(lease.mailbox, &self.callback(id), &state, expires)
            .await?;
        record_subscription(&span, "created", &subscription);
        self.repository.bind_watch(lease, id, &subscription).await
    }
}

/// How long a working subscription waits for its next renewal.
const UPKEEP_SECONDS: u32 = 12 * 60 * 60;

/// When a failed upkeep run tries again, and how many failed runs in a row
/// that makes. Throttling and credential failures belong to the mailbox's
/// requests, not its subscription, so they keep their own delays and are not
/// counted. Anything else Graph answers waits 30 s, doubling with each failed
/// run: up to 30 minutes for a transient failure (5xx, no answer), which an
/// outage gives every mailbox, and up to the 12 hours a working subscription
/// waits for a refusal (403, 404, any other 4xx), which Graph gives the same
/// way every time. The mailbox keeps syncing by polling meanwhile.
fn upkeep_retry(error: &MailboxError, failures: i32) -> (u32, i32) {
    let backoff = |cap: u32| {
        let doublings = failures.clamp(0, 11).unsigned_abs();
        ((30_u32 << doublings).min(cap), failures.saturating_add(1))
    };
    match error {
        MailboxError::Provider(
            error @ (EmailApiError::RateLimited { .. }
            | EmailApiError::CredentialsUnavailable { .. }
            | EmailApiError::AuthRequired),
        ) => (super::retry::retry_seconds(error), failures),
        MailboxError::Provider(EmailApiError::Transient { .. }) => {
            backoff(super::retry::MAX_BACKOFF_SECONDS)
        }
        MailboxError::Provider(_) => backoff(UPKEEP_SECONDS),
        _ => (30, failures),
    }
}

/// `action` is `renewed` or `created`; a failed attempt records `renew` or
/// `create` instead, so the span says which call failed.
fn record_subscription(span: &Span, action: &'static str, subscription: &MailboxSubscription) {
    span.record("outlook.subscription_action", action);
    span.record(
        "outlook.subscription_expires_at",
        subscription.expires_at.to_rfc3339(),
    );
}
