//! Push notifications are authenticated hints for the durable sync journal.

use super::*;
use chrono::{DateTime, Duration, Utc};
use email_api_client::domain::models::{MailboxSubscription, MailboxWatchDetails};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tracing::{Instrument, Span};

pub struct WatchLease {
    pub mailbox: MailboxKey,
    pub lease_id: Uuid,
    pub revision: i64,
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
    fn release_watch(
        &self,
        lease: &WatchLease,
        delay: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn notification_binding(
        &self,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<WatchAttempt>, MailboxError>> + Send;
    /// Wakes the mailbox the notification is for and returns its link, or
    /// `None` when the subscription no longer belongs to a syncing mailbox.
    fn accept_notification(
        &self,
        id: Uuid,
        expected: &WatchAttempt,
        subscription: &str,
        hint: &WatchHint,
    ) -> impl Future<Output = Result<Option<Uuid>, MailboxError>> + Send;
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
pub struct MailboxWatchNotifications<R>(pub R);
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
            outlook.notifications_accepted = 0i64,
            outlook.lifecycle_events = 0i64,
            otel.status_description = tracing::field::Empty,
        );
        self.accept(id, notifications)
            .instrument(span.clone())
            .await
            .inspect_err(|error| {
                span.record("otel.status_description", tracing::field::display(error));
            })
    }

    async fn accept(
        &self,
        id: Uuid,
        notifications: Vec<WatchNotification>,
    ) -> Result<(), MailboxError> {
        let span = Span::current();
        let Some(binding) = self.0.notification_binding(id).await? else {
            return Ok(());
        };
        let mut accepted = 0i64;
        let mut lifecycle_events = 0i64;
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
            let Some(link_id) = self
                .0
                .accept_notification(
                    id,
                    &binding,
                    &notification.subscription_id,
                    &notification.hint,
                )
                .await?
            else {
                continue;
            };
            accepted += 1;
            span.record("mailbox.link_id", tracing::field::display(link_id));
            if let Some(event) = notification.hint.lifecycle_event() {
                lifecycle_events += 1;
                if matches!(notification.hint, WatchHint::Missed) {
                    tracing::warn!(%link_id, lifecycle_event = event, "outlook subscription lifecycle event");
                } else {
                    tracing::info!(%link_id, lifecycle_event = event, "outlook subscription lifecycle event");
                }
            }
        }
        span.record("outlook.notifications_accepted", accepted);
        span.record("outlook.lifecycle_events", lifecycle_events);
        Ok(())
    }
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
            outlook.subscriptions_removed = 0i64,
            outlook.outcome = tracing::field::Empty,
            outlook.defer_reason = tracing::field::Empty,
            outlook.defer_seconds = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        async {
            let result = super::maintain_lease(self.execute(&lease), || {
                self.repository.renew_watch_lease(&lease)
            })
            .await;
            let delay = match &result {
                Ok(()) => 12 * 60 * 60,
                Err(MailboxError::Provider(e)) => super::retry_seconds(e),
                _ => 30,
            };
            self.repository.release_watch(&lease, delay).await?;
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
    async fn execute(&self, lease: &WatchLease) -> Result<(), MailboxError> {
        let span = Span::current();
        let remote = self.gateway.watches(lease.mailbox).await?;
        let mut removed = 0i64;
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
                removed += 1;
                span.record("outlook.subscriptions_removed", removed);
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

/// `action` is `renewed` or `created`; a failed attempt records `renew` or
/// `create` instead, so the span says which call failed.
fn record_subscription(span: &Span, action: &'static str, subscription: &MailboxSubscription) {
    span.record("outlook.subscription_action", action);
    span.record(
        "outlook.subscription_expires_at",
        subscription.expires_at.to_rfc3339(),
    );
}
