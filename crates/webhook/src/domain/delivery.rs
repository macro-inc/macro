//! Webhook event delivery state machine and retry policy.

#[cfg(test)]
mod test;

use super::{
    models::{
        PreparedWebhookDelivery, WebhookDeliveryAttempt, WebhookDeliveryStatus,
        WebhookEventQueueMessage, WebhookHttpOutcome, WebhookHttpOutcomeDetails, WebhookStatus,
        WebhookWorkerDisposition,
    },
    ports::{WebhookDeliveryClient, WebhookDeliveryRepository, WebhookEventDeliveryService},
};
use chrono::Utc;
use std::time::Duration;

const MAX_HTTP_ATTEMPTS: u32 = 5;
const RETRY_DELAYS: [Duration; 4] = [
    Duration::from_secs(30),
    Duration::from_secs(60),
    Duration::from_secs(120),
    Duration::from_secs(300),
];

/// Error returned while processing a queued webhook event.
#[derive(Debug, thiserror::Error)]
pub enum WebhookEventDeliveryError {
    /// The delivery repository failed to prepare or persist delivery state.
    #[error("webhook delivery repository failed: {0}")]
    Repository(#[source] anyhow::Error),
    /// The HTTP client encountered an internal failure with no delivery outcome.
    #[error("webhook delivery client failed: {0}")]
    Client(#[source] anyhow::Error),
    /// A non-terminal delivery has already reached the domain's attempt limit.
    #[error("webhook delivery has already started {0} attempts; maximum is five")]
    AttemptLimitReached(u32),
    /// The repository returned an attempt outside the domain's one-based limit.
    #[error("webhook delivery repository returned invalid attempt number {0}")]
    InvalidAttemptNumber(u32),
    /// The repository declined a due, non-terminal delivery without exposing updated state.
    #[error("webhook delivery repository did not begin a due delivery attempt")]
    AttemptNotStarted,
}

/// Domain implementation of webhook event delivery and retry policy.
#[derive(Debug, Clone)]
pub struct WebhookEventDeliveryServiceImpl<R, C> {
    repository: R,
    client: C,
}

impl<R, C> WebhookEventDeliveryServiceImpl<R, C> {
    /// Create a webhook event delivery service.
    pub fn new(repository: R, client: C) -> Self {
        Self { repository, client }
    }
}

impl<R, C> WebhookEventDeliveryServiceImpl<R, C>
where
    R: WebhookDeliveryRepository,
    C: WebhookDeliveryClient,
{
    fn repository_error(error: R::Err) -> WebhookEventDeliveryError {
        WebhookEventDeliveryError::Repository(error.into())
    }

    fn client_error(error: C::Err) -> WebhookEventDeliveryError {
        WebhookEventDeliveryError::Client(error.into())
    }

    async fn cancel_ineligible_delivery(
        &self,
        delivery_id: &str,
    ) -> Result<WebhookWorkerDisposition, WebhookEventDeliveryError> {
        self.repository
            .cancel_delivery(delivery_id)
            .await
            .map_err(Self::repository_error)?;
        record_delivery_status(WebhookDeliveryStatus::Canceled.as_str());
        Ok(WebhookWorkerDisposition::Acknowledge)
    }

    async fn disposition_after_declined_attempt(
        &self,
        message: &WebhookEventQueueMessage,
    ) -> Result<WebhookWorkerDisposition, WebhookEventDeliveryError> {
        let Some(prepared) = self
            .repository
            .prepare_delivery(message)
            .await
            .map_err(Self::repository_error)?
        else {
            record_delivery_status("missing");
            return Ok(WebhookWorkerDisposition::Acknowledge);
        };

        tracing::Span::current().record("delivery_id", prepared.delivery_id.as_str());
        record_delivery_status(prepared.status.as_str());

        if prepared.status.is_terminal() {
            return Ok(WebhookWorkerDisposition::Acknowledge);
        }
        if !webhook_is_eligible(&prepared) {
            return self.cancel_ineligible_delivery(&prepared.delivery_id).await;
        }
        if let Some(delay) = remaining_delay(&prepared) {
            record_retry_delay(delay);
            return Ok(WebhookWorkerDisposition::RetryAfter(delay));
        }

        Err(WebhookEventDeliveryError::AttemptNotStarted)
    }

    async fn record_outcome(
        &self,
        attempt: &WebhookDeliveryAttempt,
        outcome: WebhookHttpOutcome,
    ) -> Result<WebhookWorkerDisposition, WebhookEventDeliveryError> {
        match outcome {
            WebhookHttpOutcome::Success(details) => {
                record_http_details(&details);
                self.repository
                    .record_success(attempt, &details)
                    .await
                    .map_err(Self::repository_error)?;
                record_delivery_status(WebhookDeliveryStatus::Delivered.as_str());
                Ok(WebhookWorkerDisposition::Acknowledge)
            }
            WebhookHttpOutcome::PermanentFailure(details) => {
                record_http_details(&details);
                self.repository
                    .record_permanent_failure(attempt, &details)
                    .await
                    .map_err(Self::repository_error)?;
                record_delivery_status(WebhookDeliveryStatus::PermanentlyFailed.as_str());
                Ok(WebhookWorkerDisposition::Acknowledge)
            }
            WebhookHttpOutcome::RetryableFailure(details)
                if attempt.attempt_number == MAX_HTTP_ATTEMPTS =>
            {
                record_http_details(&details);
                self.repository
                    .record_exhaustion(attempt, &details)
                    .await
                    .map_err(Self::repository_error)?;
                record_delivery_status(WebhookDeliveryStatus::Exhausted.as_str());
                Ok(WebhookWorkerDisposition::Acknowledge)
            }
            WebhookHttpOutcome::RetryableFailure(details) => {
                record_http_details(&details);
                let delay = retry_delay(attempt.attempt_number).ok_or(
                    WebhookEventDeliveryError::InvalidAttemptNumber(attempt.attempt_number),
                )?;
                let next_attempt_at = Utc::now()
                    + chrono::Duration::from_std(delay)
                        .expect("webhook retry delays fit in chrono::Duration");

                self.repository
                    .record_retryable_failure(attempt, &details, next_attempt_at)
                    .await
                    .map_err(Self::repository_error)?;
                record_delivery_status(WebhookDeliveryStatus::RetryScheduled.as_str());
                record_retry_delay(delay);
                Ok(WebhookWorkerDisposition::RetryAfter(delay))
            }
        }
    }
}

impl<R, C> WebhookEventDeliveryService for WebhookEventDeliveryServiceImpl<R, C>
where
    R: WebhookDeliveryRepository,
    C: WebhookDeliveryClient,
{
    type Err = WebhookEventDeliveryError;

    #[tracing::instrument(
        skip(self, message),
        fields(
            webhook_id = %message.webhook_id,
            event_id = %message.event.event_id,
            delivery_id = tracing::field::Empty,
            attempt_id = tracing::field::Empty,
            attempt_number = tracing::field::Empty,
            status = tracing::field::Empty,
            http_status = tracing::field::Empty,
            duration_ms = tracing::field::Empty,
            retry_delay_seconds = tracing::field::Empty,
        ),
        err
    )]
    async fn deliver_event(
        &self,
        message: WebhookEventQueueMessage,
    ) -> Result<WebhookWorkerDisposition, Self::Err> {
        let Some(prepared) = self
            .repository
            .prepare_delivery(&message)
            .await
            .map_err(Self::repository_error)?
        else {
            record_delivery_status("missing");
            return Ok(WebhookWorkerDisposition::Acknowledge);
        };

        tracing::Span::current().record("delivery_id", prepared.delivery_id.as_str());
        record_delivery_status(prepared.status.as_str());

        if prepared.status.is_terminal() {
            return Ok(WebhookWorkerDisposition::Acknowledge);
        }
        if !webhook_is_eligible(&prepared) {
            return self.cancel_ineligible_delivery(&prepared.delivery_id).await;
        }
        if let Some(delay) = remaining_delay(&prepared) {
            record_retry_delay(delay);
            return Ok(WebhookWorkerDisposition::RetryAfter(delay));
        }
        if prepared.attempt_count >= MAX_HTTP_ATTEMPTS {
            return Err(WebhookEventDeliveryError::AttemptLimitReached(
                prepared.attempt_count,
            ));
        }

        let Some(attempt) = self
            .repository
            .begin_attempt(&prepared.delivery_id)
            .await
            .map_err(Self::repository_error)?
        else {
            return self.disposition_after_declined_attempt(&message).await;
        };

        if !(1..=MAX_HTTP_ATTEMPTS).contains(&attempt.attempt_number) {
            return Err(WebhookEventDeliveryError::InvalidAttemptNumber(
                attempt.attempt_number,
            ));
        }

        tracing::Span::current().record("attempt_id", attempt.attempt_id.as_str());
        tracing::Span::current().record("attempt_number", attempt.attempt_number);
        record_delivery_status(WebhookDeliveryStatus::InProgress.as_str());

        let outcome = self
            .client
            .deliver(&prepared.webhook, &message.event)
            .await
            .map_err(Self::client_error)?;

        self.record_outcome(&attempt, outcome).await
    }
}

fn webhook_is_eligible(prepared: &PreparedWebhookDelivery) -> bool {
    prepared.webhook.status == WebhookStatus::Active
        && prepared.webhook.is_valid
        && prepared.webhook.deleted_at.is_none()
}

fn retry_delay(attempt_number: u32) -> Option<Duration> {
    let delay_index = usize::try_from(attempt_number.checked_sub(1)?).ok()?;
    RETRY_DELAYS.get(delay_index).copied()
}

fn remaining_delay(prepared: &PreparedWebhookDelivery) -> Option<Duration> {
    let next_attempt_at = prepared.next_attempt_at?;
    next_attempt_at
        .signed_duration_since(Utc::now())
        .to_std()
        .ok()
}

fn record_delivery_status(status: &str) {
    tracing::Span::current().record("status", status);
}

fn record_http_details(details: &WebhookHttpOutcomeDetails) {
    if let Some(status) = details.response_status {
        tracing::Span::current().record("http_status", status);
    }
    let duration_ms = u64::try_from(details.duration.as_millis()).unwrap_or(u64::MAX);
    tracing::Span::current().record("duration_ms", duration_ms);
}

fn record_retry_delay(delay: Duration) {
    tracing::Span::current().record("retry_delay_seconds", delay.as_secs());
}
