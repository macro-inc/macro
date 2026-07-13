//! Inbound worker for queued webhook events.
//!
//! The worker owns queue polling and receipt handling. Delivery state, HTTP
//! attempts, and retry policy remain in the domain delivery service.

#[cfg(test)]
mod test;

use std::time::Duration;

use crate::domain::{
    models::{RawWebhookEventQueueMessage, WebhookEventQueueMessage, WebhookWorkerDisposition},
    ports::{WebhookEventDeliveryService, WebhookEventQueue},
};

const POLL_RETRY_DELAY: Duration = Duration::from_secs(1);

/// Continuously receives and processes queued webhook events.
///
/// Messages in each received batch are processed sequentially so events from
/// the same FIFO message group cannot be reordered within a batch.
pub struct WebhookEventWorker<Q, S> {
    queue: Q,
    service: S,
}

impl<Q, S> WebhookEventWorker<Q, S>
where
    Q: WebhookEventQueue,
    S: WebhookEventDeliveryService,
{
    /// Create a worker using the queue transport and delivery domain service.
    pub fn new(queue: Q, service: S) -> Self {
        Self { queue, service }
    }

    /// Run the webhook event worker until the task is canceled.
    pub async fn run(&self) -> ! {
        loop {
            self.poll_and_process_batch().await;
        }
    }

    async fn poll_and_process_batch(&self) {
        let messages = match self.queue.receive_messages().await {
            Ok(messages) => messages,
            Err(error) => {
                let error: anyhow::Error = error.into();
                tracing::error!(error = ?error, "failed to receive webhook event messages");
                tokio::time::sleep(POLL_RETRY_DELAY).await;
                return;
            }
        };

        if messages.is_empty() {
            tokio::time::sleep(POLL_RETRY_DELAY).await;
            return;
        }

        tracing::debug!(count = messages.len(), "received webhook event messages");
        for message in messages {
            self.process_message(message).await;
        }
    }

    #[tracing::instrument(
        skip(self, message),
        fields(message_id = message.message_id.as_deref().unwrap_or("unknown"))
    )]
    async fn process_message(&self, message: RawWebhookEventQueueMessage) {
        let Some(body) = message.body.as_deref() else {
            tracing::warn!("acknowledging webhook event message without a body");
            self.acknowledge_poison_message(message.receipt_handle.as_deref())
                .await;
            return;
        };

        let queue_message = match serde_json::from_str::<WebhookEventQueueMessage>(body) {
            Ok(queue_message) => queue_message,
            Err(error) => {
                tracing::warn!(
                    error = ?error,
                    "acknowledging malformed webhook event message"
                );
                self.acknowledge_poison_message(message.receipt_handle.as_deref())
                    .await;
                return;
            }
        };

        if !queue_message.has_supported_version() {
            tracing::warn!(
                version = queue_message.version,
                "acknowledging unsupported webhook event message version"
            );
            self.acknowledge_poison_message(message.receipt_handle.as_deref())
                .await;
            return;
        }

        let Some(receipt_handle) = message.receipt_handle.as_deref() else {
            tracing::error!(
                webhook_id = %queue_message.webhook_id,
                event_id = %queue_message.event.event_id,
                "cannot process webhook event message without a receipt handle"
            );
            return;
        };

        let disposition = match self.service.deliver_event(queue_message).await {
            Ok(disposition) => disposition,
            Err(error) => {
                let error: anyhow::Error = error.into();
                tracing::error!(error = ?error, "failed to process webhook event message");
                return;
            }
        };

        match disposition {
            WebhookWorkerDisposition::Acknowledge => {
                if let Err(error) = self.queue.delete_message(receipt_handle).await {
                    let error: anyhow::Error = error.into();
                    tracing::error!(error = ?error, "failed to acknowledge webhook event message");
                }
            }
            WebhookWorkerDisposition::RetryAfter(delay) => {
                if let Err(error) = self.queue.delay_message(receipt_handle, delay).await {
                    let error: anyhow::Error = error.into();
                    tracing::error!(
                        error = ?error,
                        delay_seconds = delay.as_secs(),
                        "failed to update webhook event message visibility"
                    );
                }
            }
        }
    }

    async fn acknowledge_poison_message(&self, receipt_handle: Option<&str>) {
        let Some(receipt_handle) = receipt_handle else {
            tracing::error!(
                "cannot acknowledge poison webhook event message without a receipt handle"
            );
            return;
        };

        if let Err(error) = self.queue.delete_message(receipt_handle).await {
            let error: anyhow::Error = error.into();
            tracing::error!(error = ?error, "failed to acknowledge poison webhook event message");
        }
    }
}
