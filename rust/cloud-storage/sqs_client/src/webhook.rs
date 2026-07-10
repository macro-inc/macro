//! Typed SQS adapter for webhook event ingestion and delivery workers.

use std::time::Duration;

use ::webhook::domain::{
    models::{RawWebhookEventQueueMessage, WebhookEventQueueMessage},
    ports::{WebhookEventEnqueuer, WebhookEventQueue},
};
use anyhow::{Context, ensure};
use aws_sdk_sqs::types::Message;

use crate::{MAX_BATCH_SIZE, SQS};

#[cfg(test)]
mod test;

const MAX_WAIT_TIME_SECONDS: i32 = 20;
const MAX_VISIBILITY_TIMEOUT_SECONDS: u64 = 12 * 60 * 60;

#[derive(Debug, PartialEq, Eq)]
struct PreparedWebhookMessage {
    body: String,
    group_id: String,
    deduplication_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct WebhookReceiveConfiguration<'a> {
    queue_url: &'a str,
    max_messages: i32,
    wait_time_seconds: i32,
}

impl SQS {
    /// Configure the webhook event queue name or URL.
    pub fn webhook_event_queue(mut self, webhook_event_queue: &str) -> Self {
        self.webhook_event_queue = Some(webhook_event_queue.to_string());
        self
    }

    /// Configure the maximum number of webhook messages requested by each poll.
    pub fn webhook_event_queue_max_messages(mut self, max_messages: i32) -> Self {
        self.webhook_event_queue_max_messages = Some(max_messages);
        self
    }

    /// Configure the webhook queue long-poll wait time in seconds.
    pub fn webhook_event_queue_wait_time_seconds(mut self, wait_time_seconds: i32) -> Self {
        self.webhook_event_queue_wait_time_seconds = Some(wait_time_seconds);
        self
    }

    fn webhook_event_queue_url(&self) -> anyhow::Result<&str> {
        let queue_url = self
            .webhook_event_queue
            .as_deref()
            .context("webhook_event_queue is not configured")?;
        ensure!(
            !queue_url.trim().is_empty(),
            "webhook_event_queue cannot be empty"
        );
        Ok(queue_url)
    }

    fn webhook_receive_configuration(&self) -> anyhow::Result<WebhookReceiveConfiguration<'_>> {
        let queue_url = self.webhook_event_queue_url()?;
        let max_messages = self
            .webhook_event_queue_max_messages
            .context("webhook_event_queue_max_messages is not configured")?;
        let wait_time_seconds = self
            .webhook_event_queue_wait_time_seconds
            .context("webhook_event_queue_wait_time_seconds is not configured")?;

        ensure!(
            (1..=MAX_BATCH_SIZE as i32).contains(&max_messages),
            "webhook_event_queue_max_messages must be between 1 and {MAX_BATCH_SIZE}"
        );
        ensure!(
            (0..=MAX_WAIT_TIME_SECONDS).contains(&wait_time_seconds),
            "webhook_event_queue_wait_time_seconds must be between 0 and {MAX_WAIT_TIME_SECONDS}"
        );

        Ok(WebhookReceiveConfiguration {
            queue_url,
            max_messages,
            wait_time_seconds,
        })
    }
}

impl WebhookEventEnqueuer for SQS {
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
        let queue_url = self.webhook_event_queue_url()?;
        let prepared = prepare_webhook_message(&message)?;

        self.inner
            .send_message()
            .queue_url(queue_url)
            .message_body(prepared.body)
            .message_group_id(prepared.group_id)
            .message_deduplication_id(prepared.deduplication_id)
            .send()
            .await?;

        Ok(())
    }
}

impl WebhookEventQueue for SQS {
    type Err = anyhow::Error;

    #[tracing::instrument(err, skip(self))]
    async fn receive_messages(&self) -> Result<Vec<RawWebhookEventQueueMessage>, Self::Err> {
        let configuration = self.webhook_receive_configuration()?;
        let output = self
            .inner
            .receive_message()
            .queue_url(configuration.queue_url)
            .max_number_of_messages(configuration.max_messages)
            .wait_time_seconds(configuration.wait_time_seconds)
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
        let queue_url = self.webhook_event_queue_url()?;
        self.inner
            .delete_message()
            .queue_url(queue_url)
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
        let queue_url = self.webhook_event_queue_url()?;
        let visibility_timeout = visibility_timeout_seconds(delay)?;

        self.inner
            .change_message_visibility()
            .queue_url(queue_url)
            .receipt_handle(receipt_handle)
            .visibility_timeout(visibility_timeout)
            .send()
            .await?;

        Ok(())
    }
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
