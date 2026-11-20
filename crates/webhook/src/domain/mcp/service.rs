//! MCP Events webhook subscriptions: subscribe, unsubscribe, fan-out and
//! delivery.

#[cfg(test)]
#[path = "service_test.rs"]
mod test;

use super::models::{
    MAX_SUBSCRIPTIONS_PER_USER, McpDeliveryOutcome, McpEventOccurrence, McpEventQueueMessage,
    McpSubscribeRequest, McpSubscribeResult, McpSubscriptionKey,
};
use super::ports::{
    McpEndpointClient, McpEndpointVerifyError, McpEventDeliveryService, McpEventEnqueuer,
    McpEventFanout, McpEventSubscriptionService, McpSecretCipher, McpSubscriptionError,
    McpSubscriptionRepo, McpSubscriptionUpsert,
};
use crate::domain::delivery::{MAX_HTTP_ATTEMPTS, retry_delay};
use crate::domain::models::{NormalizedWebhookEvent, WebhookWorkerDisposition};
use chrono::Utc;
use futures::future::try_join_all;
use macro_user_id::user_id::MacroUserIdStr;
use std::time::Duration;
use uuid::Uuid;

/// Redelivery delay after a failure that is ours, not the endpoint's.
const INTERNAL_RETRY_DELAY: Duration = Duration::from_secs(30);

/// Subscribe and unsubscribe.
#[derive(Clone)]
pub struct McpEventSubscriptionServiceImpl<R, E> {
    repo: R,
    endpoint: E,
}

impl<R, E> McpEventSubscriptionServiceImpl<R, E> {
    /// Create the service.
    pub fn new(repo: R, endpoint: E) -> Self {
        Self { repo, endpoint }
    }
}

impl<R, E> McpEventSubscriptionService for McpEventSubscriptionServiceImpl<R, E>
where
    R: McpSubscriptionRepo,
    E: McpEndpointClient,
{
    #[tracing::instrument(
        name = "mcp_events.subscribe",
        skip_all,
        fields(
            event_type = %request.event_type,
            subscription_id = tracing::field::Empty,
            verified = tracing::field::Empty,
            refreshed = tracing::field::Empty,
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
        let refreshed = existing.as_ref().is_some_and(|row| row.is_live(now));
        span.record("refreshed", refreshed);

        // The filter is a pure function of the arguments, so a refresh keeps
        // the one already compiled for them.
        let filter = match (request.filter, existing) {
            (Some(filter), _) => filter,
            (None, Some(existing)) => existing.filter,
            (None, None) => return Err(McpSubscriptionError::FilterRequired),
        };
        filter
            .validate()
            .map_err(|error| McpSubscriptionError::InvalidParams(error.to_string()))?;

        self.repo
            .delete_expired(&key.user_id)
            .await
            .map_err(McpSubscriptionError::internal)?;
        if !refreshed {
            let live = self
                .repo
                .count_live(&key.user_id)
                .await
                .map_err(McpSubscriptionError::internal)?;
            if live >= MAX_SUBSCRIPTIONS_PER_USER {
                return Err(McpSubscriptionError::ResourceExhausted {
                    max: MAX_SUBSCRIPTIONS_PER_USER,
                });
            }
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

        let row = self
            .repo
            .upsert(McpSubscriptionUpsert {
                id: Uuid::now_v7(),
                key,
                subscription_id,
                filter,
                secret: request.secret_ciphertext,
                expires_at: request.ttl.grant(now),
            })
            .await
            .map_err(McpSubscriptionError::internal)?;
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
}

impl<R, Q> McpEventFanoutImpl<R, Q> {
    /// Create the fan-out.
    pub fn new(repo: R, queue: Q) -> Self {
        Self { repo, queue }
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
        let candidates = self
            .repo
            .list_live_matching(audience.to_vec(), &event.event_name)
            .await
            .map_err(McpSubscriptionError::internal)?;
        let span = tracing::Span::current();
        span.record("candidate_count", candidates.len());
        let matched: Vec<_> = candidates
            .into_iter()
            .filter(|subscription| {
                subscription.filter.matches(
                    &event.event_name,
                    &event.entity_id,
                    &event.broker_envelope,
                    subscription.user_id.as_ref(),
                )
            })
            .collect();
        span.record("match_count", matched.len());
        try_join_all(matched.iter().map(|subscription| {
            self.queue
                .enqueue_mcp(McpEventQueueMessage::new(subscription.id, event.clone()))
        }))
        .await
        .map_err(McpSubscriptionError::internal)?;
        Ok(matched.len())
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
        )
    )]
    async fn deliver(
        &self,
        message: McpEventQueueMessage,
        receive_count: u32,
    ) -> WebhookWorkerDisposition {
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
        let occurrence = McpEventOccurrence::new(&subscription.event_type, &message.event);
        let body = match serde_json::to_vec(&occurrence) {
            Ok(body) => body,
            Err(error) => {
                tracing::error!(error = ?error, "failed to encode mcp event occurrence");
                return Attempt::Permanent;
            }
        };
        match self
            .endpoint
            .deliver(
                &subscription.endpoint_url,
                &secret,
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
                Attempt::Retry(
                    retry_delay(receive_count).unwrap_or(INTERNAL_RETRY_DELAY),
                )
            }
        }
    }
}
