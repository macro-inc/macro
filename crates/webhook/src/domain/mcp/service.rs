//! MCP Events webhook subscriptions: subscribe, unsubscribe, fan-out and
//! delivery.

#[cfg(test)]
#[path = "service_test.rs"]
mod test;

use super::live_subscribers::McpLiveSubscribers;
use super::models::{
    MAX_ARGUMENTS_BYTES, MAX_DELIVERY_BYTES, MAX_SUBSCRIPTIONS_PER_USER, McpDeliveryOutcome,
    McpEventOccurrence, McpEventQueueMessage, McpEventSubscription, McpPreviousSecret,
    McpSubscribeRequest, McpSubscribeResult, McpSubscriptionKey, SECRET_ROTATION_WINDOW,
};
use super::ports::{
    McpEndpointClient, McpEndpointVerifyError, McpEventDeliveryService, McpEventEnqueuer,
    McpEventFanout, McpEventSubscriptionService, McpSecretCipher, McpStoreOutcome,
    McpSubscriptionError, McpSubscriptionRepo, McpSubscriptionUpsert,
};
use crate::domain::delivery::{MAX_HTTP_ATTEMPTS, retry_delay};
use crate::domain::models::{NormalizedWebhookEvent, WebhookWorkerDisposition};
use chrono::{DateTime, Utc};
use futures::StreamExt as _;
use macro_user_id::user_id::MacroUserIdStr;
use std::time::Duration;
use uuid::Uuid;
use webhook_signature::standard::SigningSecret;

/// Redelivery delay after a failure that is ours, not the endpoint's.
const INTERNAL_RETRY_DELAY: Duration = Duration::from_secs(30);
/// Most audience users one match query names; a wider audience is matched
/// in several, so each query's work stays bounded.
/// With at most 50 subscriptions per user and 4 KiB per filter, one query
/// returns at most 5,000 filters (20 MiB).
pub const AUDIENCE_CHUNK: usize = 100;
/// Expired subscriptions one sweep statement deletes. The repository's SQL
/// writes it as a literal, so the planner knows the limit in every plan.
pub const SWEEP_BATCH: u32 = 500;
/// Most queue sends in flight for one event's fan-out.
const MAX_CONCURRENT_ENQUEUES: usize = 16;

/// Most sweep statements in one round; the next round continues.
pub const SWEEP_MAX_BATCHES: u32 = 20;

/// Refuse arguments that cannot be stored: too large, or holding a NUL
/// character, which PostgreSQL rejects in `jsonb`. The filter's own checks
/// are part of [`super::filter::McpEventFilter::validate`].
fn check_arguments(arguments: &serde_json::Value) -> Result<(), McpSubscriptionError> {
    if serde_json::to_vec(arguments).map_or(true, |bytes| bytes.len() > MAX_ARGUMENTS_BYTES) {
        return Err(McpSubscriptionError::InvalidParams(format!(
            "arguments must be at most {MAX_ARGUMENTS_BYTES} bytes of JSON"
        )));
    }
    if holds_nul(arguments) {
        return Err(McpSubscriptionError::InvalidParams(
            "arguments must not hold a NUL character".to_owned(),
        ));
    }
    Ok(())
}

/// Whether any key or string in `value` holds a NUL character.
fn holds_nul(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::String(text) => text.contains('\0'),
        serde_json::Value::Array(items) => items.iter().any(holds_nul),
        serde_json::Value::Object(fields) => fields
            .iter()
            .any(|(key, field)| key.contains('\0') || holds_nul(field)),
        serde_json::Value::Null | serde_json::Value::Bool(_) | serde_json::Value::Number(_) => {
            false
        }
    }
}

/// Subscribe and unsubscribe.
#[derive(Clone)]
pub struct McpEventSubscriptionServiceImpl<R, E, X> {
    repo: R,
    endpoint: E,
    cipher: X,
}

impl<R, E, X> McpEventSubscriptionServiceImpl<R, E, X> {
    /// Create the service. `cipher` opens a refreshed subscription's stored
    /// secret, to tell whether the refresh replaces it.
    pub fn new(repo: R, endpoint: E, cipher: X) -> Self {
        Self {
            repo,
            endpoint,
            cipher,
        }
    }
}

impl<R, E, X> McpEventSubscriptionServiceImpl<R, E, X>
where
    X: McpSecretCipher,
{
    /// The secret deliveries are also signed with after `row` is refreshed
    /// with `secret`: its current one when the refresh replaces it, else any
    /// earlier replaced one whose window is still open. A stored secret that
    /// cannot be opened is replaced without overlap: deliveries are then
    /// signed with the new secret alone, which is what the client sent.
    async fn previous_secret(
        &self,
        row: &McpEventSubscription,
        secret: &SigningSecret,
        now: DateTime<Utc>,
    ) -> Option<McpPreviousSecret> {
        match self.cipher.decrypt(&row.user_id, &row.secret).await {
            Ok(stored) if stored.same_key(secret) => row
                .previous_secret
                .clone()
                .filter(|previous| previous.expires_at > now),
            Ok(_) => {
                tracing::Span::current().record("secret_rotated", true);
                Some(McpPreviousSecret {
                    secret: row.secret.clone(),
                    expires_at: now + SECRET_ROTATION_WINDOW,
                })
            }
            Err(error) => {
                tracing::warn!(error = ?error, "failed to open a refreshed mcp subscription's secret");
                None
            }
        }
    }
}

impl<R, E, X> McpEventSubscriptionService for McpEventSubscriptionServiceImpl<R, E, X>
where
    R: McpSubscriptionRepo,
    E: McpEndpointClient,
    X: McpSecretCipher,
{
    #[tracing::instrument(
        name = "mcp_events.subscribe",
        skip_all,
        fields(
            event_type = %request.event_type,
            profile = %request.profile,
            subscription_id = tracing::field::Empty,
            verified = tracing::field::Empty,
            refreshed = tracing::field::Empty,
            secret_rotated = tracing::field::Empty,
        ),
        err
    )]
    async fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
        request: McpSubscribeRequest,
    ) -> Result<McpSubscribeResult, McpSubscriptionError> {
        let key = McpSubscriptionKey {
            user_id,
            endpoint_url: request.endpoint_url,
            event_type: request.event_type,
            arguments: request.arguments,
        };
        let subscription_id = key.id();
        let span = tracing::Span::current();
        span.record("subscription_id", subscription_id.as_str());

        let now = Utc::now();
        let existing = self
            .repo
            .get(&key.user_id, &subscription_id)
            .await
            .map_err(McpSubscriptionError::internal)?;
        let live = existing.filter(|row| row.is_live(now));
        span.record("refreshed", live.is_some());

        let filter = request.filter;
        filter
            .validate()
            .map_err(|error| McpSubscriptionError::InvalidParams(error.to_string()))?;
        check_arguments(&key.arguments)?;
        // The URL is bound as text before the endpoint parses it.
        if key.endpoint_url.contains('\0') {
            return Err(McpSubscriptionError::InvalidParams(
                "delivery.url must not hold a NUL character".to_owned(),
            ));
        }

        // A live subscription of this user to this URL means the endpoint
        // already proved it wants their deliveries.
        let verified = self
            .repo
            .has_live_endpoint(&key.user_id, &key.endpoint_url)
            .await
            .map_err(McpSubscriptionError::internal)?;
        span.record("verified", verified);
        if !verified {
            self.endpoint
                .verify(&key.endpoint_url, &request.secret, &subscription_id)
                .await
                .map_err(|error| match error {
                    McpEndpointVerifyError::InvalidUrl(message) => {
                        McpSubscriptionError::InvalidParams(message.to_owned())
                    }
                    McpEndpointVerifyError::Failed(failure) => {
                        McpSubscriptionError::CallbackEndpoint(failure)
                    }
                })?;
        }

        // A refresh may replace the secret; deliveries then carry both
        // signatures for a while, so a receiver still on the old one accepts
        // them.
        let previous_secret = match &live {
            Some(row) => self.previous_secret(row, &request.secret, now).await,
            None => None,
        };

        // The quota is checked again where the row is written, under a
        // per-user lock, so concurrent subscribes cannot pass it together.
        let stored = self
            .repo
            .store_within_quota(
                McpSubscriptionUpsert {
                    id: Uuid::now_v7(),
                    key,
                    subscription_id,
                    filter,
                    secret: request.secret_ciphertext,
                    previous_secret,
                    profile: request.profile,
                    expires_at: request.ttl.grant(now),
                },
                MAX_SUBSCRIPTIONS_PER_USER,
            )
            .await
            .map_err(McpSubscriptionError::internal)?;
        let row = match stored {
            McpStoreOutcome::Stored(row) => *row,
            McpStoreOutcome::QuotaExceeded => {
                return Err(McpSubscriptionError::ResourceExhausted {
                    max: MAX_SUBSCRIPTIONS_PER_USER,
                });
            }
        };
        Ok(McpSubscribeResult {
            id: row.subscription_id,
            refresh_before: row.expires_at,
            filter: row.filter,
        })
    }

    #[tracing::instrument(
        name = "mcp_events.unsubscribe",
        skip_all,
        fields(event_type = %key.event_type, subscription_id = tracing::field::Empty),
        err
    )]
    async fn unsubscribe(&self, key: McpSubscriptionKey) -> Result<(), McpSubscriptionError> {
        let subscription_id = key.id();
        tracing::Span::current().record("subscription_id", subscription_id.as_str());
        let deleted = self
            .repo
            .delete(&key.user_id, &subscription_id)
            .await
            .map_err(McpSubscriptionError::internal)?;
        if deleted {
            Ok(())
        } else {
            Err(McpSubscriptionError::NotFound)
        }
    }
}

/// Matches ingested events to subscriptions and queues them.
#[derive(Clone)]
pub struct McpEventFanoutImpl<R, Q> {
    repo: R,
    queue: Q,
    subscribers: McpLiveSubscribers,
}

impl<R, Q> McpEventFanoutImpl<R, Q> {
    /// Create the fan-out. `subscribers` narrows each audience to the users
    /// with a live subscription before any query; whoever owns it keeps it
    /// refreshed.
    pub fn new(repo: R, queue: Q, subscribers: McpLiveSubscribers) -> Self {
        Self {
            repo,
            queue,
            subscribers,
        }
    }
}

impl<R, Q> McpEventFanout for McpEventFanoutImpl<R, Q>
where
    R: McpSubscriptionRepo,
    Q: McpEventEnqueuer,
{
    #[tracing::instrument(
        name = "mcp_events.fan_out",
        skip_all,
        fields(
            event_id = %event.event_id,
            event_name = %event.event_name,
            audience_count = audience.len(),
            subscribers_known = tracing::field::Empty,
            queried_audience_count = tracing::field::Empty,
            candidate_count = tracing::field::Empty,
            match_count = tracing::field::Empty,
        ),
        err
    )]
    async fn fan_out(
        &self,
        event: &NormalizedWebhookEvent,
        audience: &[String],
    ) -> Result<usize, McpSubscriptionError> {
        if audience.is_empty() {
            return Ok(0);
        }
        let span = tracing::Span::current();
        // Most events reach no subscriber, and then cost no query. Without a
        // known set, every audience member is matched.
        let narrowed = self.subscribers.narrow(audience);
        span.record("subscribers_known", narrowed.is_some());
        let audience = narrowed.as_deref().unwrap_or(audience);
        span.record("queried_audience_count", audience.len());
        let mut candidate_count = 0;
        // Only the matching row ids are kept; each chunk's filters are dropped
        // with it.
        let mut matched: Vec<Uuid> = Vec::new();
        // Each chunk is one bounded query; most events have a small audience
        // and run one.
        for chunk in audience.chunks(AUDIENCE_CHUNK) {
            let candidates = self
                .repo
                .list_match_candidates(chunk, &event.event_name)
                .await
                .map_err(McpSubscriptionError::internal)?;
            candidate_count += candidates.len();
            matched.extend(
                candidates
                    .into_iter()
                    .filter(|candidate| {
                        candidate.filter.matches(
                            &event.event_name,
                            &event.entity_id,
                            &event.broker_envelope,
                            candidate.user_id.as_ref(),
                        )
                    })
                    .map(|candidate| candidate.id),
            );
        }
        span.record("candidate_count", candidate_count);
        span.record("match_count", matched.len());
        // A few sends at a time; each message's copy of the event is made
        // only when its send starts. Every send runs to the end even after
        // one fails, so a failing send never cancels a healthy one.
        let mut sends = futures::stream::iter(matched.iter().copied())
            .map(|id| {
                self.queue
                    .enqueue_mcp(McpEventQueueMessage::new(id, event.clone()))
            })
            .buffer_unordered(MAX_CONCURRENT_ENQUEUES);
        let mut first_error = None;
        while let Some(sent) = sends.next().await {
            if let Err(error) = sent {
                first_error.get_or_insert(error);
            }
        }
        if let Some(error) = first_error {
            return Err(McpSubscriptionError::internal(error));
        }
        Ok(matched.len())
    }
}

/// Deletes expired subscriptions, so users who never subscribe again do not
/// keep their expired rows.
#[derive(Clone)]
pub struct McpSubscriptionSweeper<R> {
    repo: R,
}

impl<R: McpSubscriptionRepo> McpSubscriptionSweeper<R> {
    /// Create the sweeper.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }

    /// Delete expired subscriptions in bounded batches, at most
    /// [`SWEEP_MAX_BATCHES`] of them; a larger backlog is left to the next
    /// round. Returns how many were deleted.
    #[tracing::instrument(
        name = "mcp_events.sweep_expired",
        skip_all,
        fields(deleted_count = tracing::field::Empty, batch_count = tracing::field::Empty),
        err
    )]
    pub async fn sweep_expired(&self) -> Result<u64, McpSubscriptionError> {
        let mut deleted = 0;
        let mut batches = 0;
        while batches < SWEEP_MAX_BATCHES {
            batches += 1;
            let removed = self
                .repo
                .delete_expired_batch()
                .await
                .map_err(McpSubscriptionError::internal)?;
            deleted += removed;
            if removed < u64::from(SWEEP_BATCH) {
                break;
            }
        }
        let span = tracing::Span::current();
        span.record("deleted_count", deleted);
        span.record("batch_count", batches);
        Ok(deleted)
    }
}

/// Delivers queued events to subscription endpoints.
#[derive(Clone)]
pub struct McpEventDeliveryServiceImpl<R, X, E> {
    repo: R,
    cipher: X,
    endpoint: E,
}

impl<R, X, E> McpEventDeliveryServiceImpl<R, X, E> {
    /// Create the delivery service.
    pub fn new(repo: R, cipher: X, endpoint: E) -> Self {
        Self {
            repo,
            cipher,
            endpoint,
        }
    }
}

impl<R, X, E> McpEventDeliveryService for McpEventDeliveryServiceImpl<R, X, E>
where
    R: McpSubscriptionRepo,
    X: McpSecretCipher,
    E: McpEndpointClient,
{
    #[tracing::instrument(
        name = "mcp_events.deliver",
        skip_all,
        fields(
            mcp_subscription_id = %message.mcp_subscription_id,
            event_id = %message.event.event_id,
            event_name = %message.event.event_name,
            attempt = receive_count,
            outcome = tracing::field::Empty,
            profile = tracing::field::Empty,
            dual_signed = tracing::field::Empty,
            body_bytes = tracing::field::Empty,
        )
    )]
    async fn deliver(
        &self,
        message: McpEventQueueMessage,
        receive_count: u32,
    ) -> WebhookWorkerDisposition {
        // The queue can hand a message out again after its last attempt (a
        // delete that did not land); it gets no further attempt.
        if receive_count > MAX_HTTP_ATTEMPTS {
            tracing::Span::current().record("outcome", "exhausted");
            return WebhookWorkerDisposition::Acknowledge;
        }
        let disposition = self.attempt(&message, receive_count).await;
        let outcome = match disposition {
            Attempt::Delivered => "delivered",
            Attempt::Gone => "subscription_gone",
            Attempt::Permanent => "permanent_failure",
            Attempt::Retry(_) if receive_count >= MAX_HTTP_ATTEMPTS => "exhausted",
            Attempt::Retry(_) => "retry",
        };
        tracing::Span::current().record("outcome", outcome);
        match disposition {
            Attempt::Retry(delay) if receive_count < MAX_HTTP_ATTEMPTS => {
                WebhookWorkerDisposition::RetryAfter(delay)
            }
            Attempt::Delivered | Attempt::Gone | Attempt::Permanent | Attempt::Retry(_) => {
                WebhookWorkerDisposition::Acknowledge
            }
        }
    }
}

enum Attempt {
    Delivered,
    /// Unsubscribed or expired since the event was queued.
    Gone,
    Permanent,
    Retry(Duration),
}

impl<R, X, E> McpEventDeliveryServiceImpl<R, X, E>
where
    R: McpSubscriptionRepo,
    X: McpSecretCipher,
    E: McpEndpointClient,
{
    async fn attempt(&self, message: &McpEventQueueMessage, receive_count: u32) -> Attempt {
        let subscription = match self.repo.get_live(message.mcp_subscription_id).await {
            Ok(Some(subscription)) => subscription,
            Ok(None) => return Attempt::Gone,
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load mcp subscription");
                return Attempt::Retry(INTERNAL_RETRY_DELAY);
            }
        };
        let secret = match self
            .cipher
            .decrypt(&subscription.user_id, &subscription.secret)
            .await
        {
            Ok(secret) => secret,
            Err(error) => {
                tracing::warn!(error = ?error, "failed to decrypt mcp subscription secret");
                return Attempt::Retry(INTERNAL_RETRY_DELAY);
            }
        };
        // During a rotation the previous secret signs too; one that cannot
        // be opened is left out, as the new one is what the client sent last.
        let previous = match subscription.signing_previous_secret(Utc::now()) {
            Some(previous) => self
                .cipher
                .decrypt(&subscription.user_id, previous)
                .await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, "failed to decrypt mcp subscription's previous secret");
                })
                .ok(),
            None => None,
        };
        let span = tracing::Span::current();
        span.record("profile", subscription.profile.as_ref());
        span.record("dual_signed", previous.is_some());
        let occurrence = McpEventOccurrence::new(
            &subscription.event_type,
            &message.event,
            subscription.profile,
            &message.webhook_message_id,
            &subscription.user_id,
        );
        let body = match serde_json::to_vec(&occurrence) {
            Ok(body) => body,
            Err(error) => {
                tracing::error!(error = ?error, "failed to encode mcp event occurrence");
                return Attempt::Permanent;
            }
        };
        span.record("body_bytes", body.len());
        // ChatGPT refuses a larger body with a 413, which is not retried.
        if body.len() > MAX_DELIVERY_BYTES {
            tracing::warn!(
                body_bytes = body.len(),
                "mcp event delivery is too large to send"
            );
            return Attempt::Permanent;
        }
        match self
            .endpoint
            .deliver(
                &subscription.endpoint_url,
                &secret,
                previous.as_ref(),
                &subscription.subscription_id,
                &message.webhook_message_id,
                body,
            )
            .await
        {
            McpDeliveryOutcome::Delivered => Attempt::Delivered,
            McpDeliveryOutcome::Permanent => Attempt::Permanent,
            McpDeliveryOutcome::Retryable(failure) => {
                tracing::info!(reason = %failure, "mcp event delivery failed; retrying");
                Attempt::Retry(retry_delay(receive_count).unwrap_or(INTERNAL_RETRY_DELAY))
            }
        }
    }
}
