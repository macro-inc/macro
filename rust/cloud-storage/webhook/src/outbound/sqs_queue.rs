//! SQS-backed webhook event queue.

#[cfg(test)]
#[path = "sqs_queue_test.rs"]
mod sqs_queue_test;

use std::time::Duration;

use anyhow::{Context, ensure};
use aws_sdk_sqs::types::Message;

use crate::domain::{
    models::{RawWebhookEventQueueMessage, WebhookEventQueueMessage},
    ports::{WebhookEventEnqueuer, WebhookEventQueue},
};

const MAX_VISIBILITY_TIMEOUT_SECONDS: u64 = 12 * 60 * 60;

/// SQS-backed implementation of webhook enqueueing and worker queue operations.
#[derive(Clone)]
pub struct SqsWebhookQueue {
    client: aws_sdk_sqs::Client,
    queue_url: String,
    max_messages: i32,
    wait_time_seconds: i32,
}

impl SqsWebhookQueue {
    /// Create a webhook queue adapter pointing at `queue_url`.
    pub fn new(
        client: aws_sdk_sqs::Client,
        queue_url: String,
        max_messages: i32,
        wait_time_seconds: i32,
    ) -> Self {
        Self {
            client,
            queue_url,
            max_messages,
            wait_time_seconds,
        }
    }
}

impl WebhookEventEnqueuer for SqsWebhookQueue {
    type Err = anyhow::Error;

    #[tracing::instrument(
        err,
        skip(self, message),
        fields(
            webhook_id = %message.webhook_id,
            event_id = %message.event.event_id,
        )
    )]
    async fn enqueue(&self, message: WebhookEventQueueMessage) -> Result<(), Self::Err> {
        let prepared = prepare_webhook_message(&message)?;

        self.client
            .send_message()
            .queue_url(&self.queue_url)
            .message_body(prepared.body)
            .message_group_id(prepared.group_id)
            .message_deduplication_id(prepared.deduplication_id)
            .send()
            .await?;

        Ok(())
    }
}

impl WebhookEventQueue for SqsWebhookQueue {
    type Err = anyhow::Error;

    #[tracing::instrument(err, skip(self))]
    async fn receive_messages(&self) -> Result<Vec<RawWebhookEventQueueMessage>, Self::Err> {
        let output = self
            .client
            .receive_message()
            .queue_url(&self.queue_url)
            .max_number_of_messages(self.max_messages)
            .wait_time_seconds(self.wait_time_seconds)
            .send()
            .await?;

        Ok(output
            .messages
            .unwrap_or_default()
            .into_iter()
            .map(raw_webhook_message)
            .collect())
    }

    #[tracing::instrument(err, skip(self, receipt_handle))]
    async fn delete_message(&self, receipt_handle: &str) -> Result<(), Self::Err> {
        self.client
            .delete_message()
            .queue_url(&self.queue_url)
            .receipt_handle(receipt_handle)
            .send()
            .await?;

        Ok(())
    }

    #[tracing::instrument(
        err,
        skip(self, receipt_handle),
        fields(delay_seconds = delay.as_secs())
    )]
    async fn delay_message(&self, receipt_handle: &str, delay: Duration) -> Result<(), Self::Err> {
        let visibility_timeout = visibility_timeout_seconds(delay)?;

        self.client
            .change_message_visibility()
            .queue_url(&self.queue_url)
            .receipt_handle(receipt_handle)
            .visibility_timeout(visibility_timeout)
            .send()
            .await?;

        Ok(())
    }
}

#[derive(Debug, PartialEq, Eq)]
struct PreparedWebhookMessage {
    body: String,
    group_id: String,
    deduplication_id: String,
}

fn prepare_webhook_message(
    message: &WebhookEventQueueMessage,
) -> anyhow::Result<PreparedWebhookMessage> {
    let group_id = message.webhook_id.clone();
    let deduplication_id = format!("{}:{}", message.webhook_id, message.event.event_id);
    let body =
        serde_json::to_string(message).context("unable to serialize webhook queue message")?;

    Ok(PreparedWebhookMessage {
        body,
        group_id,
        deduplication_id,
    })
}

fn raw_webhook_message(message: Message) -> RawWebhookEventQueueMessage {
    RawWebhookEventQueueMessage {
        message_id: message.message_id,
        body: message.body,
        receipt_handle: message.receipt_handle,
    }
}

fn visibility_timeout_seconds(delay: Duration) -> anyhow::Result<i32> {
    let seconds = delay.as_secs();
    ensure!(
        seconds <= MAX_VISIBILITY_TIMEOUT_SECONDS,
        "webhook message visibility delay cannot exceed {MAX_VISIBILITY_TIMEOUT_SECONDS} seconds"
    );

    Ok(seconds as i32)
}
